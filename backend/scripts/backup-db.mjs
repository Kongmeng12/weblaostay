/**
 * A logical backup of the database and the uploaded photos.
 *
 *   npm run backup
 *   node scripts/backup-db.mjs --out D:\somewhere\else
 *
 * This machine has no `pg_dump` and no `psql`, so the dump is taken through
 * the `pg` client that is already a dependency. That buys portability at the
 * cost of fidelity: this captures *rows*, not the schema, not sequences, not
 * functions. The schema is already in version control as
 * `prisma/migrations-v2/*.sql`, so a rebuild is "run the migrations, then
 * restore the rows" — which is what `restore-db.mjs` does.
 *
 * Two things a Neon dump alone would miss, and this does not:
 *
 *  - `uploads/` lives on this disk. Photos are referenced from the database as
 *    `/uploads/<key>` paths, so a database restored without them leaves every
 *    listing pointing at a 404.
 *  - The row counts and the foreign-key graph are written into `_meta.json`,
 *    so a restore can order its inserts and a human can tell at a glance
 *    whether a backup is plausible before trusting it.
 *
 * Values arrive already safe from `pg`: int8 and numeric come back as strings
 * rather than lossy JS numbers, which is the whole reason for going through
 * the driver instead of hand-rolling JSON in SQL.
 *
 * The backups live on the same disk as the thing they protect, which is worth
 * nothing against a dead drive. Copy them somewhere else periodically.
 */
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const kong = path.join(root, '..');

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      const value = l.slice(i + 1).trim().replace(/^(['"])(.*)$/, '$2');
      return [l.slice(0, i).trim(), value];
    }),
);

if (!env.DATABASE_URL) {
  console.error('\nDATABASE_URL is not set in backend/.env\n');
  process.exit(1);
}

/**
 * `sslmode=require` makes pg 8 print a paragraph-long deprecation warning on
 * every connection, saying it currently behaves as `verify-full` and to ask
 * for that by name. Spelling it out here is that same behaviour with none of
 * the noise — and a nightly log nobody can read at a glance is a nightly log
 * nobody reads. `.env` is left alone; Prisma does not go through pg.
 */
const connectionString = env.DATABASE_URL.replace(/sslmode=require/, 'sslmode=verify-full');

/** Never print the password, not even into a log nobody reads. */
const target = env.DATABASE_URL.replace(/:[^:@]+@/, ':****@');

const KEEP_DAYS = 14;
const outFlag = process.argv.indexOf('--out');
const backupRoot =
  outFlag >= 0 && process.argv[outFlag + 1]
    ? path.resolve(process.argv[outFlag + 1])
    : path.join(kong, 'deploy', 'backups');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp =
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
  `_${pad(now.getHours())}${pad(now.getMinutes())}`;
const dir = path.join(backupRoot, stamp);

/**
 * JSON cannot hold a Date or a Buffer, and losing which one a column was is
 * how a restore quietly turns a timestamp into a string. Both are tagged;
 * everything else `pg` hands back is already JSON-safe.
 */
function encode(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return { __t: 'date', v: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __t: 'buf', v: value.toString('base64') };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object') {
    // jsonb columns come back parsed. Their contents are plain JSON by
    // definition, so they pass through untouched rather than being walked.
    return value;
  }
  return value;
}

const human = (bytes) =>
  bytes < 1024 ? `${bytes} B`
  : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const db = new Client({ connectionString });

console.log(`\nBackup → ${dir}`);
console.log(`Source  ${target}\n`);

await db.connect();

const { rows: tables } = await db.query(
  `SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`,
);

if (!tables.length) {
  console.error('No tables found in schema "public" — refusing to write an empty backup.\n');
  await db.end();
  process.exit(1);
}

// The foreign-key graph, so a restore can insert parents before children
// without having to guess from table names.
//
// The child column and its nullability are recorded, not just the two table
// names, because this schema contains a genuine cycle: `conversations` points
// at its own last message and `messages` points back at its conversation. No
// insert order satisfies both. A restore breaks such a cycle by inserting the
// nullable side as NULL and filling it in afterwards, which it can only do if
// it knows which column to blank.
const { rows: fks } = await db.query(
  `SELECT tc.table_name  AS child,
          kcu.column_name AS "childColumn",
          ccu.table_name  AS parent,
          ccu.column_name AS "parentColumn",
          col.is_nullable = 'YES' AS nullable
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.constraint_schema = tc.constraint_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
      AND ccu.constraint_schema = tc.constraint_schema
     JOIN information_schema.columns col
       ON col.table_schema = tc.table_schema
      AND col.table_name = tc.table_name
      AND col.column_name = kcu.column_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'`,
);

// Primary keys, so a restore can address a single row when it goes back to
// fill in the columns it had to blank.
const { rows: pkRows } = await db.query(
  `SELECT tc.table_name AS table, kcu.column_name AS column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
    ORDER BY kcu.ordinal_position`,
);
const primaryKeys = {};
for (const { table, column } of pkRows) (primaryKeys[table] ??= []).push(column);

fs.mkdirSync(dir, { recursive: true });

const counts = {};
const columns = {};
let totalRows = 0;
let totalBytes = 0;

for (const { table_name: table } of tables) {
  const { rows: cols } = await db.query(
    `SELECT column_name, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  columns[table] = Object.fromEntries(cols.map((c) => [c.column_name, c.udt_name]));

  const { rows } = await db.query(`SELECT * FROM "${table}"`);

  const file = path.join(dir, `${table}.ndjson.gz`);
  const gzip = zlib.createGzip({ level: 9 });
  const out = fs.createWriteStream(file);
  const done = new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
    gzip.on('error', reject);
  });
  gzip.pipe(out);

  for (const row of rows) {
    const encoded = {};
    for (const [key, value] of Object.entries(row)) encoded[key] = encode(value);
    gzip.write(`${JSON.stringify(encoded)}\n`);
  }
  gzip.end();
  await done;

  const size = fs.statSync(file).size;
  counts[table] = rows.length;
  totalRows += rows.length;
  totalBytes += size;

  console.log(`  ${table.padEnd(28)} ${String(rows.length).padStart(6)} rows  ${human(size)}`);
}

await db.end();

// Photos. The database only stores `/uploads/<key>` paths, so without these
// a restored site is a catalogue of broken images.
const uploadsSrc = path.join(kong, 'uploads');
let uploadFiles = 0;
let uploadBytes = 0;
if (fs.existsSync(uploadsSrc)) {
  const dest = path.join(dir, 'uploads');
  fs.cpSync(uploadsSrc, dest, { recursive: true });
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        uploadFiles++;
        uploadBytes += fs.statSync(p).size;
      }
    }
  };
  walk(dest);
  totalBytes += uploadBytes;
}
console.log(`  ${'uploads/'.padEnd(28)} ${String(uploadFiles).padStart(6)} files ${human(uploadBytes)}`);

fs.writeFileSync(
  path.join(dir, '_meta.json'),
  `${JSON.stringify(
    {
      takenAt: now.toISOString(),
      source: target,
      format: 'ndjson.gz, one file per table, Date and Buffer tagged with __t',
      tables: tables.map((t) => t.table_name),
      rowCounts: counts,
      columns,
      primaryKeys,
      foreignKeys: fks,
      uploads: { files: uploadFiles, bytes: uploadBytes },
    },
    null,
    2,
  )}\n`,
);

// Keep the last fortnight. Named by timestamp rather than read from mtime, so
// copying a backup around does not change when it expires.
const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
let pruned = 0;
for (const name of fs.readdirSync(backupRoot)) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(name);
  if (!m || name === stamp) continue;
  const when = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (when < cutoff) {
    fs.rmSync(path.join(backupRoot, name), { recursive: true, force: true });
    pruned++;
  }
}

// ASCII only from here down: this line is what lands in deploy\logs\backup.log,
// and PowerShell 5.1's Get-Content reads a UTF-8 file as ANSI by default, so
// anything fancier comes back as mojibake in the one place someone checks
// whether last night's backup ran.
console.log(
  `\n${tables.length} tables | ${totalRows} rows | ${uploadFiles} photos | ${human(totalBytes)}` +
    `${pruned ? ` | pruned ${pruned} backup(s) older than ${KEEP_DAYS} days` : ''}\n` +
    `${dir}\n`,
);

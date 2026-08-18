/**
 * Puts a `backup-db.mjs` dump back into a database.
 *
 *   node scripts/restore-db.mjs ..\deploy\backups\2026-08-18_1448
 *   node scripts/restore-db.mjs ..\deploy\backups\2026-08-18_1448 --apply
 *
 * Without `--apply` this only reads: it opens every file, decodes every row,
 * checks the counts against `_meta.json`, works out the insert order and
 * reports what it would do. That dry run is the part worth running often —
 * it is what tells you a backup is readable *before* you need it to be.
 *
 * The restore itself replaces the contents of every table in the dump. Rows
 * are deleted child-first and inserted parent-first, following the foreign-key
 * graph recorded at backup time, and each table's identity sequence is moved
 * past the highest restored id so the next insert does not collide with a row
 * that came out of the backup.
 *
 * The schema is not restored — this only carries rows. Rebuild the schema from
 * `prisma/migrations-v2/*.sql` first, then run this.
 *
 * `--apply` refuses outright when NODE_ENV=production, in the same spirit as
 * `run-migration-v2.mjs`: pointing a restore at the live database is a thing
 * to do deliberately and by hand, having first taken a fresh backup of what is
 * about to be overwritten.
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

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dir = args.find((a) => !a.startsWith('--'));

if (!dir) {
  console.error('\nUsage: node scripts/restore-db.mjs <backup-dir> [--apply]\n');
  process.exit(1);
}

const backup = path.resolve(dir);
const metaPath = path.join(backup, '_meta.json');
if (!fs.existsSync(metaPath)) {
  console.error(`\nNo _meta.json in ${backup} — that is not a backup directory.\n`);
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const target = (env.DATABASE_URL ?? '').replace(/:[^:@]+@/, ':****@');
// Same behaviour, without pg 8's deprecation notice — see backup-db.mjs.
const connectionString = (env.DATABASE_URL ?? '').replace(/sslmode=require/, 'sslmode=verify-full');

const nodeEnv = process.env.NODE_ENV ?? env.NODE_ENV;
if (apply && nodeEnv === 'production') {
  console.error(
    '\nRefusing to run: NODE_ENV=production.\n' +
      'This replaces the contents of every table in the backup. If you mean to\n' +
      'restore the live database, take a fresh backup first and run this by\n' +
      'hand with NODE_ENV unset.\n',
  );
  process.exit(1);
}

/** Undoes the tagging `backup-db.mjs` applies to Dates and Buffers. */
function decode(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value === 'object') {
    if (value.__t === 'date') return new Date(value.v);
    if (value.__t === 'buf') return Buffer.from(value.v, 'base64');
    return value;
  }
  return value;
}

function readTable(table) {
  const file = path.join(backup, `${table}.ndjson.gz`);
  if (!fs.existsSync(file)) return null;
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/**
 * Works out an insert order, and which columns have to be left out of it.
 *
 * Parents before children, except that this schema contains a real cycle —
 * `conversations.last_message_id` points at `messages`, `messages
 * .conversation_id` points back — and `messages.reply_to_message_id` points
 * into its own table. No ordering satisfies either, so the nullable side is
 * *deferred*: inserted as NULL and updated once every table is loaded.
 *
 * Only enough edges are deferred to make progress, so a schema without cycles
 * defers nothing and restores in a single pass.
 */
function plan(tables, foreignKeys) {
  const present = new Set(tables);
  const edges = foreignKeys.filter((f) => present.has(f.child) && present.has(f.parent));
  const deferred = new Map();

  const defer = (f) => {
    if (!deferred.has(f.child)) deferred.set(f.child, new Set());
    deferred.get(f.child).add(f.childColumn);
  };
  const isDeferred = (f) => deferred.get(f.child)?.has(f.childColumn) ?? false;

  // A row referencing another row in the same table cannot be helped by any
  // table ordering; that column is always filled in afterwards.
  for (const f of edges) if (f.child === f.parent && f.nullable) defer(f);

  for (;;) {
    const active = edges.filter((f) => f.child !== f.parent && !isDeferred(f));
    const parents = new Map(tables.map((t) => [t, new Set()]));
    for (const f of active) parents.get(f.child).add(f.parent);

    const order = [];
    const placed = new Set();
    for (;;) {
      const ready = tables.filter(
        (t) => !placed.has(t) && [...parents.get(t)].every((p) => placed.has(p)),
      );
      if (!ready.length) break;
      for (const t of ready) {
        order.push(t);
        placed.add(t);
      }
    }
    if (order.length === tables.length) return { order, deferred, unresolved: [] };

    const stuck = new Set(tables.filter((t) => !placed.has(t)));
    const breakable = active.filter((f) => f.nullable && stuck.has(f.child) && stuck.has(f.parent));
    if (!breakable.length) {
      // A cycle of NOT NULL columns. Nothing this script can do about that.
      return { order: [...order, ...stuck], deferred, unresolved: [...stuck] };
    }
    for (const f of breakable) defer(f);
  }
}

const { order, deferred, unresolved } = plan(meta.tables, meta.foreignKeys ?? []);

console.log(`\nBackup  ${backup}`);
console.log(`Taken   ${meta.takenAt}`);
console.log(`Target  ${target}`);
console.log(apply ? '\nMode    APPLY — tables in this backup will be replaced\n' : '\nMode    dry run (add --apply to write)\n');

// ── read and check every file, whether or not we are writing ─────────────────
const data = new Map();
const problems = [];
let totalRows = 0;

for (const table of order) {
  const rows = readTable(table);
  if (rows === null) {
    problems.push(`${table}: no ${table}.ndjson.gz in the backup`);
    continue;
  }
  const expected = meta.rowCounts?.[table];
  if (expected !== undefined && expected !== rows.length) {
    problems.push(`${table}: ${rows.length} rows in the file, _meta.json says ${expected}`);
  }
  data.set(table, rows);
  totalRows += rows.length;
}

const uploadsSrc = path.join(backup, 'uploads');
const uploadCount = fs.existsSync(uploadsSrc)
  ? fs.readdirSync(uploadsSrc, { recursive: true }).filter((f) => {
      try {
        return fs.statSync(path.join(uploadsSrc, f)).isFile();
      } catch {
        return false;
      }
    }).length
  : 0;

console.log(`  ${order.length} tables readable · ${totalRows} rows decoded · ${uploadCount} photos`);
for (const [table, cols] of deferred) {
  const filled = (data.get(table) ?? []).filter((r) => [...cols].some((c) => r[c] != null)).length;
  console.log(`  ↻ ${table}.${[...cols].join(', ')} inserted as NULL, then ${filled} row(s) updated`);
}
if (unresolved.length) {
  problems.push(`cycle of NOT NULL foreign keys among: ${unresolved.join(', ')}`);
}
for (const p of problems) console.log(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s) — refusing to restore from a backup that does not check out.\n`);
  process.exit(1);
}

if (!apply) {
  console.log('\nInsert order:');
  console.log(`  ${order.filter((t) => data.get(t).length).join(', ')}`);
  console.log('\nBackup checks out. Re-run with --apply to write it.\n');
  process.exit(0);
}

// ── write ───────────────────────────────────────────────────────────────────
const db = new Client({ connectionString });
await db.connect();

const live = new Map();
for (const table of order) {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  live.set(table, new Set(rows.map((r) => r.column_name)));
}

await db.query('BEGIN');
try {
  // Children first, so nothing is deleted out from under a foreign key.
  for (const table of [...order].reverse()) {
    if (!live.get(table).size) continue;
    await db.query(`DELETE FROM "${table}"`);
  }

  for (const table of order) {
    const rows = data.get(table);
    const present = live.get(table);
    if (!rows.length || !present.size) continue;

    const cols = Object.keys(rows[0]).filter((c) => present.has(c));
    const missing = Object.keys(rows[0]).filter((c) => !present.has(c));
    if (missing.length) console.log(`  ⚠ ${table}: dropping columns absent from the schema: ${missing.join(', ')}`);

    const hold = deferred.get(table) ?? new Set();
    const quoted = cols.map((c) => `"${c}"`).join(', ');
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const values = [];
      const tuples = chunk.map((row, r) => {
        const slots = cols.map((c, j) => {
          // Deferred columns point at rows that do not exist yet — see plan().
          values.push(hold.has(c) ? null : decode(row[c]));
          return `$${r * cols.length + j + 1}`;
        });
        return `(${slots.join(', ')})`;
      });
      await db.query(`INSERT INTO "${table}" (${quoted}) VALUES ${tuples.join(', ')}`, values);
    }
    console.log(`  ${table.padEnd(28)} ${String(rows.length).padStart(6)} rows`);
  }

  // Everything is in, so the columns held back above can now be filled in.
  let refilled = 0;
  for (const [table, cols] of deferred) {
    const rows = data.get(table) ?? [];
    const pk = meta.primaryKeys?.[table] ?? [];
    const targets = [...cols].filter((c) => live.get(table).has(c));
    if (!rows.length || !targets.length) continue;
    if (!pk.length) {
      throw new Error(`${table} has deferred columns but no primary key recorded — cannot fill them in`);
    }

    const sets = targets.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    const where = pk.map((c, i) => `"${c}" = $${targets.length + i + 1}`).join(' AND ');
    for (const row of rows) {
      if (!targets.some((c) => row[c] != null)) continue;
      await db.query(`UPDATE "${table}" SET ${sets} WHERE ${where}`, [
        ...targets.map((c) => decode(row[c])),
        ...pk.map((c) => decode(row[c])),
      ]);
      refilled++;
    }
  }
  if (refilled) console.log(`  ${String(refilled).padStart(30)} deferred reference(s) filled in`);

  // Identity sequences still point wherever they were before the delete, which
  // for a fresh schema is 1 — the next insert would collide with restored ids.
  const { rows: seqs } = await db.query(
    `SELECT c.relname AS table_name, a.attname AS column_name,
            pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS seq
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL`,
  );
  let bumped = 0;
  for (const { table_name, column_name, seq } of seqs) {
    if (!data.has(table_name) || !data.get(table_name).length) continue;
    await db.query(
      `SELECT setval($1, COALESCE((SELECT MAX("${column_name}") FROM "${table_name}"), 0) + 1, false)`,
      [seq],
    );
    bumped++;
  }

  await db.query('COMMIT');
  console.log(`\n  ${bumped} sequence(s) moved past the restored ids`);
} catch (err) {
  await db.query('ROLLBACK');
  await db.end();
  console.error(`\nRolled back — nothing was changed.\n${err.message}\n`);
  process.exit(1);
}

await db.end();

if (uploadCount) {
  fs.cpSync(uploadsSrc, path.join(kong, 'uploads'), { recursive: true });
  console.log(`  ${uploadCount} photo(s) copied back into uploads/`);
}

console.log(`\nRestored ${totalRows} rows from ${meta.takenAt}\n`);

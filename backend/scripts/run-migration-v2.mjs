// Applies prisma/migrations-v2/*.sql in filename order.
//
// Deliberately awkward to run: 0001 begins with `DROP SCHEMA public CASCADE`.
// There is no undo, and `DATABASE_URL` points at a hosted database, so the
// thing being destroyed is never "just a local dev copy".
//
//   npm run db:reset -- --yes
//
// The flag is not passed by the npm script on purpose. A `db:reset` that
// carried `--yes` itself would be exactly the stray script this guard exists
// to prevent — the warning would print for nobody and the safety would be
// decoration.
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const target = (env.DATABASE_URL ?? '').replace(/:[^:@]+@/, ':****@');

// No flag makes this safe against a production database. Nothing here is
// recoverable, so this refuses outright rather than asking.
const nodeEnv = process.env.NODE_ENV ?? env.NODE_ENV;
if (nodeEnv === 'production') {
  console.error(
    '\nRefusing to run: NODE_ENV=production.\n' +
      'This drops the schema and every row in it. If you genuinely mean to\n' +
      'rebuild a production database, do it by hand and take a backup first.\n',
  );
  process.exit(1);
}

if (!process.argv.includes('--yes')) {
  console.error(
    `\nThis DROPS the public schema and every row in it, then rebuilds v2.\n\n` +
      `  target: ${target}\n\n` +
      'There is no way back. Re-run with --yes if that is what you want:\n\n' +
      '  npm run db:reset -- --yes\n',
  );
  process.exit(1);
}

const dir = path.join(root, 'prisma', 'migrations-v2');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const client = new Client({ connectionString: env.DATABASE_URL });
await client.connect();

console.log(`\nTarget: ${target}\n`);

for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  process.stdout.write(`→ ${file} ... `);
  try {
    // Each file wraps itself in BEGIN/COMMIT, so a failure inside one leaves
    // that file's work rolled back rather than half-applied.
    await client.query(sql);
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    console.error(err.message);
    await client.end();
    process.exit(1);
  }
}

const { rows: counts } = await client.query(`
  SELECT
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
    (SELECT count(*) FROM pg_indexes WHERE schemaname='public') AS indexes,
    (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typtype='e')               AS enums,
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)    AS triggers`);

const c = counts[0];
console.log(
  `\nDone. ${c.tables} tables · ${c.indexes} indexes · ${c.enums} enums · ${c.triggers} triggers.`,
);

// Dropping the schema takes PostGIS with it, and 0001 installs it again with
// fresh OIDs. `DATABASE_URL` points at Neon's *pooled* endpoint, whose server
// backends outlive any one client connection and go on caching the catalog
// from before the reset. A backend that does will answer a geography query
// with:
//
//   ERROR: no spatial operator found for 'st_dwithin': opfamily N type M
//
// It is not a code fault and it clears itself as the pooler recycles, but it
// looks exactly like a broken index, so it is worth naming here rather than
// leaving the next person to work it out.
console.log(
  'Restart the API before running the smoke suite — pooled connections can\n' +
    'still hold the pre-reset PostGIS catalog and will fail spatial queries.\n',
);
await client.end();

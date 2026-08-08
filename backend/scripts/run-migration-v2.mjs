// Applies prisma/migrations-v2/*.sql in filename order.
//
// Deliberately separate from run-migration.mjs, and deliberately awkward to
// run: 0001 begins with `DROP SCHEMA public CASCADE`. There is no undo. The
// --yes flag exists so this cannot happen by muscle memory or a stray npm
// script.
//
//   node scripts/run-migration-v2.mjs --yes
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');

if (!process.argv.includes('--yes')) {
  console.error(
    '\nThis DROPS the public schema and every row in it, then rebuilds v2.\n' +
      'There is no way back. Re-run with --yes if that is what you want.\n',
  );
  process.exit(1);
}

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

const dir = path.join(root, 'prisma', 'migrations-v2');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const client = new Client({ connectionString: env.DATABASE_URL });
await client.connect();

console.log(`\nTarget: ${env.DATABASE_URL.replace(/:[^:@]+@/, ':****@')}\n`);

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
await client.end();

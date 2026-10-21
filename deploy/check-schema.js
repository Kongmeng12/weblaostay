// Refuses a deploy whose Prisma schema expects tables, columns or enum values
// the database does not have yet.
//
// Prisma selects every column a model declares, so one column added to
// schema.prisma without its migration being run breaks every query on that
// table — on 2026-10-21 a new `properties.maps_url` took every property page
// down with 500s. This runs before the new build is switched in, while the old
// one is still serving, and prints the SQL that is missing.
//
// Read-only: `prisma migrate diff` compares, it never writes.
//
// Usage (from a backend folder holding .env and prisma/schema.prisma):
//   node ../deploy/check-schema.js [path/to/schema.prisma]
// Exit 0 = the database has everything the schema needs; 1 = something is
// missing (listed); 2 = the check itself failed.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const backend = process.cwd();
require(path.join(backend, 'node_modules', 'dotenv')).config({ path: path.join(backend, '.env'), quiet: true });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('check-schema: DATABASE_URL is not set in .env');
  process.exit(2);
}

const schema = process.argv[2] || 'prisma/schema.prisma';
const prisma = path.join(backend, 'node_modules', 'prisma', 'build', 'index.js');
const run = spawnSync(
  process.execPath,
  [prisma, 'migrate', 'diff', '--from-url', url, '--to-schema-datamodel', schema, '--script'],
  { cwd: backend, encoding: 'utf8', env: { ...process.env, DIRECT_URL: url } },
);
if (run.status !== 0) {
  console.error('check-schema: prisma migrate diff failed\n' + (run.stderr || run.stdout));
  process.exit(2);
}

// The diff also lists things the schema does not model on purpose — CHECK
// constraints, partial indexes, generated columns, triggers. Only what the
// code would actually query for counts as missing.
const missing = run.stdout
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /ADD COLUMN|CREATE TABLE|CREATE TYPE|ADD VALUE/i.test(s));

if (missing.length) {
  console.error('The database is missing what this build needs. Run the matching');
  console.error('prisma/migrations-v2 file(s) first — nothing was deployed:\n');
  for (const s of missing) console.error('  ' + s.replace(/\s+/g, ' ') + ';');
  process.exit(1);
}
console.log('check-schema: the database has every table and column the schema uses.');

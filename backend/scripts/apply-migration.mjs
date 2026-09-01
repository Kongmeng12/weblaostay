// Applies ONE file from prisma/migrations-v2/ against the live dev database,
// without touching anything else already there.
//
// Unlike `db:reset` (which drops and rebuilds the whole schema from 0001),
// this is for the common case of adding a single new migration on top of a
// database that already has real data in it.
//
//   node scripts/apply-migration.mjs 0012_stay_completed_review_notification.sql
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-migration.mjs <filename.sql>');
  process.exit(1);
}

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

const sqlPath = path.join(root, 'prisma', 'migrations-v2', file);
const sql = fs.readFileSync(sqlPath, 'utf8');

const target = (env.DATABASE_URL ?? '').replace(/:[^:@]+@/, ':****@');
console.log(`Target: ${target}\nApplying: ${file}\n`);

const client = new Client({ connectionString: env.DATABASE_URL });
await client.connect();
try {
  await client.query(sql);
  console.log('ok');
} catch (err) {
  console.log('FAILED');
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

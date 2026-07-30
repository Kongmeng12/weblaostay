// Applies prisma/migrations/*.sql in filename order.
//
// We do not use `prisma migrate` here: the 17 design tables were created outside
// Prisma, so `migrate dev` would want to reset the database to match its own
// migration history. These scripts are additive and idempotent instead.
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// minimal .env reader — avoids a dependency just to boot a script
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

const dir = path.join(root, 'prisma', 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const client = new Client({ connectionString: env.DATABASE_URL });
await client.connect();

for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  process.stdout.write(`→ ${file} ... `);
  try {
    await client.query(sql);
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    console.error(err.message);
    await client.end();
    process.exit(1);
  }
}

const { rows } = await client.query(
  `select count(*)::int n from pg_indexes where schemaname='public'`,
);
console.log(`\nDone. ${files.length} migration(s) applied, ${rows[0].n} indexes now on public.`);
await client.end();

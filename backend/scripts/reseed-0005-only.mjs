// One-off: re-applies ONLY prisma/migrations-v2/0005_demo_data.sql against the
// live DB — lighter than `npm run db:reset`, which also drops and rebuilds
// the whole schema plus 0004's master data and 0006's CMS content. 0005
// already wraps itself in BEGIN/COMMIT and TRUNCATEs exactly the tables it
// repopulates (users, properties, room_types, bookings, chat, wishlist,
// property_images, ...), so re-running just this file is enough to pick up
// the new per-property room types.
//
// Not wired into package.json on purpose — this is a one-off, not a
// repeatable command someone should reach for by habit.
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
      const value = l.slice(i + 1).trim().replace(/^(['"])(.*)$/, '$2');
      return [l.slice(0, i).trim(), value];
    }),
);

const nodeEnv = process.env.NODE_ENV ?? env.NODE_ENV;
if (nodeEnv === 'production') {
  console.error('Refusing to run: NODE_ENV=production.');
  process.exit(1);
}

const target = (env.DATABASE_URL ?? '').replace(/:[^:@]+@/, ':****@');
console.log(`Target: ${target}`);

const client = new Client({ connectionString: env.DATABASE_URL });
await client.connect();

const sql = fs.readFileSync(path.join(root, 'prisma/migrations-v2/0005_demo_data.sql'), 'utf8');
try {
  await client.query(sql);
  console.log('0005_demo_data.sql applied OK.');
} catch (err) {
  console.error('FAILED:', err.message);
  await client.end();
  process.exit(1);
}

const { rows } = await client.query(`
  SELECT pr.property_name, rt.type_name, rt.base_price, rt.total_rooms
  FROM properties pr JOIN room_types rt ON rt.property_id = pr.property_id
  ORDER BY pr.property_name, rt.base_price`);
console.table(rows);

await client.end();

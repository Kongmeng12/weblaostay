// One-off, non-destructive: updates the 4 existing room_types row-in-place
// per property (matched by property_name + the old shared type_name) so each
// property gets its own distinct lineup — instead of the truncate-and-reseed
// path in 0005_demo_data.sql, which would also wipe users, bookings, chat,
// wishlists and uploaded photos.
//
// Because this UPDATEs existing rows rather than delete+insert, room_type_id
// never changes — every booking_items/room_inventory/room_prices row that
// already points at these ids keeps pointing at the same (now relabeled)
// room. Only the room's own name/description/price/bed/occupancy/room-count
// fields change.
//
// After relabeling, the forward-looking room_prices window (weekday/weekend
// markup) is regenerated from today at the *new* base_price — the old window
// was computed off the old prices and would otherwise show stale numbers for
// whatever's left of its original 90 days. Past dates aren't touched: a
// booking's price is snapshotted onto booking_items at the time it was made
// and never re-reads room_prices.
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

const target = (env.DATABASE_URL ?? '').replace(/:[^:@]+@/, ':****@');
console.log(`Target: ${target}`);

// [property_name, old type_name] -> new room definition. One row per
// property per old slot — every property still ends up with exactly 4 room
// types, just relabeled to fit what that property actually is.
const UPDATES = [
  // Vintage House Vientiane — boutique guesthouse, ໃຈກາງນະຄອນຫຼວງ
  ['Vintage House Vientiane', 'Standard Fan',
    ['Vintage Single', 'ຫ້ອງເດ່ຍວສະໄໝເກົ່າ ພັດລົມ ຫ້ອງນ້ຳໃນຕົວ', 'single', false, 1, 250000, 4, 1, 40000]],
  ['Vintage House Vientiane', 'Standard AC',
    ['Vintage Double AC', 'ຫ້ອງຄູ່ຕົກແຕ່ງແບບເກົ່າ ມີແອ', 'double', true, 2, 400000, 6, 1, 50000]],
  ['Vintage House Vientiane', 'Deluxe',
    ['Heritage Deluxe', 'ຫ້ອງກວ້າງແບບເຮືອນເກົ່າ ມີລະບຽງໄມ້', 'double', true, 3, 650000, 3, 1, 80000]],
  ['Vintage House Vientiane', 'Family Suite',
    ['Heritage Suite', 'ຫ້ອງສະວີດແບບເຮືອນເກົ່າ ຫ້ອງນັ່ງຫຼິ້ນແຍກ', 'twin', true, 4, 850000, 2, 1, 90000]],

  // Hom Sabay Guesthouse — homestay ບັນຍາກາດຄອບຄົວ, ຫຼວງພະບາງ
  ['Hom Sabay Guesthouse', 'Standard Fan',
    ['Cozy Fan Room', 'ຫ້ອງນ້ອຍ ພັດລົມ ບັນຍາກາດອົບອຸ່ນ', 'single', false, 1, 180000, 5, 1, 30000]],
  ['Hom Sabay Guesthouse', 'Standard AC',
    ['Family Double', 'ຕຽງຄູ່ ມີແອ ເໝາະສຳລັບຄູ່ຮັກ', 'double', true, 2, 350000, 6, 1, 50000]],
  ['Hom Sabay Guesthouse', 'Deluxe',
    ['Traditional Lao Room', 'ຫ້ອງສະໄຕລ໌ລາວດັ້ງເດີມ ມີລະບຽງ', 'double', true, 2, 420000, 3, 1, 55000]],
  ['Hom Sabay Guesthouse', 'Family Suite',
    ['Riverside Twin', 'ສອງຕຽງ ວິວແມ່ນ້ຳຂອງ', 'twin', true, 3, 480000, 4, 2, 60000]],

  // Mekong View Resort — ຣີສອດຕິດແມ່ນ້ຳຂອງ, ປາກເຊ
  ['Mekong View Resort', 'Standard Fan',
    ['Garden Bungalow', 'ບັງກະໂລຕິດສວນ ສະຫງົບ', 'double', true, 2, 550000, 8, 1, 70000]],
  ['Mekong View Resort', 'Standard AC',
    ['River View Room', 'ຫ້ອງວິວແມ່ນ້ຳຂອງ ຊົມພະອາທິດຕົກ', 'double', true, 2, 750000, 6, 1, 90000]],
  ['Mekong View Resort', 'Deluxe',
    ['Sunset Suite', 'ຫ້ອງສະວີດວິວພະອາທິດຕົກ ລະບຽງກວ້າງ', 'double', true, 3, 950000, 2, 1, 100000]],
  ['Mekong View Resort', 'Family Suite',
    ['Pool Villa', 'ວິນລ່າຕິດສະລອຍນ້ຳ ເໝາະສຳລັບຄອບຄົວ', 'twin', true, 4, 1200000, 3, 2, 120000]],

  // Vang Vieng Riverside — ວິນລ່າລິມນ້ຳຊອງ ວິວພູຫິນປູນ
  ['Vang Vieng Riverside', 'Standard Fan',
    ['Mountain View Twin', 'ສອງຕຽງ ວິວພູຫິນປູນ', 'twin', true, 2, 500000, 5, 1, 60000]],
  ['Vang Vieng Riverside', 'Standard AC',
    ['Riverside Double', 'ຕຽງຄູ່ ຕິດລິມນ້ຳຊອງ', 'double', true, 2, 580000, 6, 1, 65000]],
  ['Vang Vieng Riverside', 'Deluxe',
    ['Riverside Suite', 'ຫ້ອງກວ້າງ ລະບຽງສ່ວນຕົວ ຕິດແມ່ນ້ຳຊອງ', 'double', true, 3, 720000, 3, 1, 75000]],
  ['Vang Vieng Riverside', 'Family Suite',
    ['Family Villa 2BR', 'ວິນລ່າ 2 ຫ້ອງນອນ ມີຄົວນ້ອຍ ເໝາະສຳລັບຄອບຄົວ', 'twin', true, 6, 1500000, 2, 2, 100000]],

  // Dokchampa Homestay — ໂຮມສະເຕນ້ອຍ ສະຫງົບ ເໝາະສຳລັບນັກເດີນທາງຄົນດຽວ
  ['Dokchampa Homestay', 'Standard Fan',
    ['Solo Fan Room', 'ຫ້ອງນ້ອຍ ພັດລົມ ເໝາະສຳລັບຄົນດຽວ', 'single', false, 1, 150000, 3, 1, 25000]],
  ['Dokchampa Homestay', 'Standard AC',
    ['Solo AC Room', 'ຫ້ອງນ້ອຍ ມີແອ ເໝາະສຳລັບຄົນດຽວ', 'single', true, 1, 220000, 3, 1, 30000]],
  ['Dokchampa Homestay', 'Deluxe',
    ['Cozy Double', 'ຕຽງຄູ່ຂະໜາດນ້ອຍ ບັນຍາກາດອົບອຸ່ນ', 'double', true, 2, 320000, 2, 1, 40000]],
  ['Dokchampa Homestay', 'Family Suite',
    ['Garden Twin Room', 'ສອງຕຽງ ຕິດສວນນ້ອຍ ສະຫງົບ', 'twin', true, 2, 380000, 1, 1, 35000]],
];

const client = new Client({ connectionString: env.DATABASE_URL });
await client.connect();

try {
  await client.query('BEGIN');

  const touchedIds = [];
  for (const [propertyName, oldTypeName, def] of UPDATES) {
    const [typeName, descr, bed, ac, occ, price, rooms, minN, extra] = def;
    const { rows, rowCount } = await client.query(
      `UPDATE room_types rt
         SET type_name = $3, description = $4, bed_type = $5::bed_type, has_ac = $6,
             max_occupancy = $7, base_price = $8, total_rooms = $9,
             min_nights = $10, extra_guest_fee = $11
       FROM properties pr
       WHERE rt.property_id = pr.property_id
         AND pr.property_name = $1
         AND rt.type_name = $2
       RETURNING rt.room_type_id`,
      [propertyName, oldTypeName, typeName, descr, bed, ac, occ, price, rooms, minN, extra],
    );
    if (rowCount !== 1) {
      throw new Error(
        `Expected exactly 1 row for ${propertyName} / ${oldTypeName}, got ${rowCount} — aborting, nothing committed.`,
      );
    }
    touchedIds.push(rows[0].room_type_id);
  }

  // Refresh the forward pricing window for just these room types so the
  // weekday/weekend markup reflects the new base_price immediately.
  await client.query('DELETE FROM room_prices WHERE room_type_id = ANY($1::bigint[])', [
    touchedIds,
  ]);
  await client.query(
    `INSERT INTO room_prices (room_type_id, date, price, price_type)
     SELECT rt.room_type_id, d::date,
            CASE WHEN EXTRACT(ISODOW FROM d) IN (5, 6)
                 THEN round(rt.base_price * 1.15)::bigint
                 ELSE rt.base_price END,
            CASE WHEN EXTRACT(ISODOW FROM d) IN (5, 6)
                 THEN 'weekend'::price_type ELSE 'weekday'::price_type END
     FROM room_types rt
     CROSS JOIN generate_series(CURRENT_DATE, CURRENT_DATE + 89, '1 day') AS d
     WHERE rt.room_type_id = ANY($1::bigint[])
     ON CONFLICT (room_type_id, date) DO NOTHING`,
    [touchedIds],
  );

  await client.query('COMMIT');
  console.log(`Updated ${touchedIds.length} room types, refreshed their pricing window.`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('FAILED, rolled back:', err.message);
  await client.end();
  process.exit(1);
}

const { rows } = await client.query(`
  SELECT pr.property_name, rt.type_name, rt.base_price, rt.total_rooms
  FROM properties pr JOIN room_types rt ON rt.property_id = pr.property_id
  ORDER BY pr.property_name, rt.base_price`);
console.table(rows);

await client.end();

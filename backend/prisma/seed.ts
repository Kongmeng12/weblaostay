/**
 * LaoStay demo seed.
 *
 * Fills the database with the partners, properties, rooms, customers and
 * bookings from the WebAdmin and PartnerApp mockups, plus enough booking
 * history for the dashboard KPIs and the 14-day GMV chart to show real curves.
 *
 * Re-runnable. Accounts (admins, partners, customers, promos) are upserted by
 * their natural key; transactional rows are cleared and regenerated so the
 * numbers stay consistent. All randomness comes from a fixed seed, so two runs
 * produce identical data.
 *
 *   npm run seed
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Deterministic PRNG so the demo data never shifts between runs. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260730);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

/**
 * Calendar days are built at UTC midnight throughout.
 *
 * Prisma writes a JS Date into a `date` column by taking its UTC day, so a
 * local-midnight Date lands a day early anywhere east of UTC. Working in UTC
 * keeps check-in/check-out and payout periods on the days they say.
 */
function daysAgo(n: number): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}
/** Monday 00:00 UTC of the week containing `ref`. */
function weekStart(ref: Date): Date {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
/** A real timestamp on the given day — for `timestamptz` columns. */
function atTime(d: Date, hour: number, minute: number): Date {
  const out = new Date(d);
  out.setUTCHours(hour, minute, 0, 0);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source data, lifted from the design mockups
// ─────────────────────────────────────────────────────────────────────────────

const ADMINS = [
  { email: 'amnuay@laostay.la', name: 'ອຳນວຍ ຈັນດາ', role: 'super_admin' },
  { email: 'bounmy@laostay.la', name: 'ບຸນມີ ສີສະຫວັນ', role: 'finance' },
  { email: 'phonsy@laostay.la', name: 'ພອນສີ ໄຊຍະ', role: 'staff' },
];

interface PropertySpec {
  name: string;
  type: string;
  province: string;
  address: string;
  lat: number;
  lng: number;
  amenities: string[];
  roomCount: number;
}

interface PartnerSpec {
  email: string;
  ownerName: string;
  phone: string;
  status: 'verified' | 'pending';
  bankName: string | null;
  bankAccount: string | null;
  /** Days before today the application was submitted. */
  joinedDaysAgo: number;
  property: PropertySpec;
}

const PARTNERS: PartnerSpec[] = [
  {
    email: 'vintage@laostay.la',
    ownerName: 'ນາງ ວັນນະສອນ ພິມມະສອນ',
    phone: '+856 20 5511 2233',
    status: 'verified',
    bankName: 'BCEL',
    bankAccount: '0301000123454192',
    joinedDaysAgo: 420,
    property: {
      name: 'ວິນເທດ ໂຮມສະເຕ',
      type: 'homestay',
      province: 'ຫຼວງພະບາງ',
      address: 'ບ້ານ ຊຽງທອງ, ເມືອງ ຫຼວງພະບາງ, ແຂວງ ຫຼວງພະບາງ',
      lat: 19.8856,
      lng: 102.1355,
      amenities: ['WiFi ຟຣີ', 'ອາຫານເຊົ້າ', 'ທີ່ຈອດລົດ', 'ແອຣ໌'],
      roomCount: 3,
    },
  },
  {
    email: 'homsabay@laostay.la',
    ownerName: 'ທ້າວ ສີສະຫວາດ ແກ້ວມະນີ',
    phone: '+856 20 5522 3344',
    status: 'verified',
    bankName: 'LDB',
    bankAccount: '0102000998877665',
    joinedDaysAgo: 380,
    property: {
      name: 'ຮ່ອມສະບາຢ ວິນລ່າ',
      type: 'villa',
      province: 'ຫຼວງນ້ຳທາ',
      address: 'ບ້ານ ນ້ຳດີ, ເມືອງ ຫຼວງນ້ຳທາ, ແຂວງ ຫຼວງນ້ຳທາ',
      lat: 20.9489,
      lng: 101.4023,
      amenities: ['WiFi ຟຣີ', 'ສະລອຍນ້ຳ', 'ທີ່ຈອດລົດ', 'ແອຣ໌'],
      roomCount: 5,
    },
  },
  {
    email: 'mekongview@laostay.la',
    ownerName: 'ນາງ ຄຳແພງ ສຸວັນນະ',
    phone: '+856 20 5533 4455',
    status: 'verified',
    bankName: 'BCEL',
    bankAccount: '0301000556677881',
    joinedDaysAgo: 300,
    property: {
      name: 'ແມ່ຂອງ ວິວ ເຮົາສ໌',
      type: 'guesthouse',
      province: 'ວັງວຽງ',
      address: 'ບ້ານ ສະຫວ່າງ, ເມືອງ ວັງວຽງ, ແຂວງ ວຽງຈັນ',
      lat: 18.9235,
      lng: 102.4487,
      amenities: ['WiFi ຟຣີ', 'ອາຫານເຊົ້າ', 'ວິວແມ່ນ້ຳ'],
      roomCount: 2,
    },
  },
  {
    email: 'xaiphoudoy@laostay.la',
    ownerName: 'ທ້າວ ບຸນເລີດ ວົງພະຈັນ',
    phone: '+856 20 5544 5566',
    status: 'verified',
    bankName: 'APB',
    bankAccount: '0405000334455662',
    joinedDaysAgo: 250,
    property: {
      name: 'ໄຊ ພູດອຢ ບັງກາໂລ',
      type: 'homestay',
      province: 'ຊຽງຂວາງ',
      address: 'ບ້ານ ໂພນສະຫວັນ, ເມືອງ ແປກ, ແຂວງ ຊຽງຂວາງ',
      lat: 19.4569,
      lng: 103.1568,
      amenities: ['WiFi ຟຣີ', 'ທີ່ຈອດລົດ', 'ພັດລົມ'],
      roomCount: 4,
    },
  },
  {
    email: 'dokchampa@laostay.la',
    ownerName: 'ນາງ ດວງໃຈ ພົມມະຈັນ',
    phone: '+856 20 5555 6677',
    status: 'verified',
    bankName: 'BCEL',
    bankAccount: '0301000778899003',
    joinedDaysAgo: 500,
    property: {
      name: 'ດອກຈຳປາ ຣີສອດ',
      type: 'resort',
      province: 'ປາກເຊ',
      address: 'ບ້ານ ໂພນສະອາດ, ເມືອງ ປາກເຊ, ແຂວງ ຈຳປາສັກ',
      lat: 15.1202,
      lng: 105.7986,
      amenities: ['WiFi ຟຣີ', 'ສະລອຍນ້ຳ', 'ອາຫານເຊົ້າ', 'ທີ່ຈອດລົດ', 'ແອຣ໌'],
      roomCount: 8,
    },
  },

  // ── Pending applications shown on the approvals screen ────────────────────
  {
    email: 'khammouane@laostay.la',
    ownerName: 'ທ້າວ ບຸນມີ ໄຊຍະສິດ',
    phone: '+856 20 5566 7788',
    status: 'pending',
    bankName: 'BCEL',
    bankAccount: '0301000112233445',
    joinedDaysAgo: 11,
    property: {
      name: 'ຄຳມ່ວນ ວິວ ພອຢຕ໌',
      type: 'guesthouse',
      province: 'ທ່າແຂກ',
      address: 'ບ້ານ ນາໂພ, ເມືອງ ທ່າແຂກ, ແຂວງ ຄຳມ່ວນ',
      lat: 17.4103,
      lng: 104.8207,
      amenities: ['WiFi ຟຣີ', 'ທີ່ຈອດລົດ'],
      roomCount: 3,
    },
  },
  {
    email: 'champahomestay@laostay.la',
    ownerName: 'ນາງ ໄຊສະຫວັນ ວົງດາລາ',
    phone: '+856 20 5577 8899',
    status: 'pending',
    bankName: 'LDB',
    bankAccount: '0102000445566778',
    joinedDaysAgo: 10,
    property: {
      name: 'ຈຳປາ ໂຮມສະເຕ',
      type: 'homestay',
      province: 'ຫຼວງນ້ຳທາ',
      address: 'ບ້ານ ວຽງໄຊ, ເມືອງ ຫຼວງນ້ຳທາ, ແຂວງ ຫຼວງນ້ຳທາ',
      lat: 20.9512,
      lng: 101.4102,
      amenities: ['WiFi ຟຣີ', 'ອາຫານເຊົ້າ'],
      roomCount: 2,
    },
  },
  {
    email: 'muangngoi@laostay.la',
    ownerName: 'ນາງ ພອນສີ ແສງອາລຸນ',
    phone: '+856 20 5588 9900',
    status: 'pending',
    bankName: 'APB',
    bankAccount: '0405000667788990',
    joinedDaysAgo: 12,
    property: {
      name: 'ເມືອງງາ ເຮືອນໄມ້',
      type: 'homestay',
      province: 'ປາກເຊ',
      address: 'ບ້ານ ດອນຄໍ້, ເມືອງ ປາກເຊ, ແຂວງ ຈຳປາສັກ',
      lat: 15.1155,
      lng: 105.8032,
      amenities: ['WiFi ຟຣີ', 'ພັດລົມ'],
      roomCount: 2,
    },
  },
  {
    email: 'donkhong@laostay.la',
    ownerName: 'ທ້າວ ຄຳສອນ ພັນທະວົງ',
    phone: '+856 20 5599 0011',
    status: 'pending',
    bankName: 'BCEL',
    bankAccount: '0301000889900112',
    joinedDaysAgo: 14,
    property: {
      name: 'ດອນໂຂງ ຣີເວອຣ໌ໄຊດ໌',
      type: 'guesthouse',
      province: 'ສີ່ພັນດອນ',
      address: 'ບ້ານ ຫາງຄອນ, ເມືອງ ໂຂງ, ແຂວງ ຈຳປາສັກ',
      lat: 14.1189,
      lng: 105.8564,
      amenities: ['WiFi ຟຣີ', 'ວິວແມ່ນ້ຳ', 'ເຮືອຮັບສົ່ງ'],
      roomCount: 3,
    },
  },
];

/** The four room archetypes from the PartnerApp room list. */
const ROOM_TYPES = [
  { name: 'Deluxe Garden View', hasAc: true, bedType: 'single', price: 450_000, capacity: 2 },
  { name: 'Standard Room', hasAc: false, bedType: 'single', price: 320_000, capacity: 2 },
  { name: 'Family Suite', hasAc: true, bedType: 'double', price: 520_000, capacity: 3 },
  { name: 'Twin Fan Room', hasAc: false, bedType: 'double', price: 400_000, capacity: 3 },
];

const CUSTOMERS = [
  { email: 'souda.v@gmail.com', name: 'ນາງ ສຸດາ ວົງສາ', phone: '+856 20 5789 1234', tier: 'gold', points: 2400, status: 'active' },
  { email: 'somphone.k@gmail.com', name: 'ທ້າວ ສົມພອນ ແກ້ວ', phone: '+856 20 2233 8890', tier: 'silver', points: 890, status: 'active' },
  { email: 'john.carter@outlook.com', name: 'Mr. John Carter', phone: '+856 20 9911 2020', tier: 'silver', points: 420, status: 'active' },
  { email: 'mali.x@gmail.com', name: 'ນາງ ມະລິ ໄຊຍະ', phone: '+856 20 5566 7788', tier: 'gold', points: 1810, status: 'active' },
  { email: 'vilay.p@gmail.com', name: 'ທ້າວ ວິໄລ ພົມມະ', phone: '+856 20 7788 1122', tier: 'silver', points: 210, status: 'suspended' },
  { email: 'lin.zhao@qq.com', name: 'Ms. Lin Zhao', phone: '+856 20 3344 5566', tier: 'silver', points: 640, status: 'active' },
];

const PROMOS = [
  { code: 'STAY30', type: 'percent', value: 30, used: 1240, expiresInDays: 1 },
  { code: 'BOUN2026', type: 'fixed', value: 150_000, used: 820, expiresInDays: 16 },
  { code: 'WEEKEND15', type: 'percent', value: 15, used: 2110, expiresInDays: 120 },
  { code: 'NEWYEAR50', type: 'percent', value: 50, used: 3450, expiresInDays: -190 },
];

const REVIEW_TEXTS = [
  { stars: 5, text: 'ທີ່ພັກສະອາດ ເຈົ້າພາບໃຈດີຫຼາຍ ວິວງາມ ຈະກັບມາອີກແນ່ນອນ.', flagged: false },
  { stars: 2, text: 'ຫ້ອງບໍ່ຄືກັບຮູບ ນ້ຳຮ້ອນບໍ່ມາ ຕິດຕໍ່ເຈົ້າຂອງຍາກ.', flagged: true },
  { stars: 4, text: 'ຕຳແໜ່ງດີ ໃກ້ຕົວເມືອງ ພຽງແຕ່ WiFi ຊ້າໜ້ອຍໜຶ່ງ.', flagged: false },
  { stars: 1, text: 'ຈອງແລ້ວແຕ່ໄປຮອດບໍ່ມີຫ້ອງ ຂໍໃຫ້ກວດສອບ Partner ນີ້.', flagged: true },
  { stars: 5, text: 'ອາຫານເຊົ້າແຊບ ບ່ອນຈອດລົດກວ້າງ ຄຸ້ມຄ່າຫຼາຍ.', flagged: false },
  { stars: 4, text: 'ພະນັກງານເປັນກັນເອງ ຫ້ອງນ້ຳສະອາດ ແນະນຳເລີຍ.', flagged: false },
];

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('LaoStay seed — target:', maskDbUrl(process.env.DATABASE_URL ?? ''));
  console.log('');

  await clearTransactional();

  const adminIds = await seedAdmins();
  const { partnerIds, propertyIds, rooms } = await seedPartnersAndProperties();
  const userIds = await seedCustomers();
  const promoIds = await seedPromos();

  const bookings = await seedBookings({ propertyIds, rooms, userIds, promoIds });
  await seedReviews(bookings);
  await seedPayouts(propertyIds);
  await seedNotifications(partnerIds, userIds);
  await seedAuditLogs(adminIds);

  await printSummary();
}

/**
 * Clears everything the seed generates, in FK-safe order. Accounts survive so
 * their ids (and anyone's saved login) stay stable across runs.
 */
async function clearTransactional() {
  console.log('Clearing generated data...');
  await prisma.chat_messages.deleteMany();
  await prisma.reviews.deleteMany();
  await prisma.cancellations.deleteMany();
  await prisma.payments.deleteMany();
  await prisma.booking_items.deleteMany();
  await prisma.bookings.deleteMany();
  await prisma.room_availability.deleteMany();
  await prisma.payouts.deleteMany();
  await prisma.wishlists.deleteMany();
  await prisma.notifications.deleteMany();
  await prisma.audit_logs.deleteMany();
}

async function seedAdmins(): Promise<bigint[]> {
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'LaoStay@2026';
  const hash = await argon2.hash(password, ARGON_OPTS);

  const ids: bigint[] = [];
  for (const a of ADMINS) {
    const admin = await prisma.admins.upsert({
      where: { email: a.email },
      create: { email: a.email, name: a.name, password_hash: hash, role: a.role },
      update: { name: a.name, role: a.role, password_hash: hash },
      select: { id: true },
    });
    ids.push(admin.id);
  }
  console.log(`  admins           ${ids.length}`);
  return ids;
}

interface SeededRoom {
  id: bigint;
  propertyId: bigint;
  price: number;
  capacity: number;
}

async function seedPartnersAndProperties() {
  const partnerIds: bigint[] = [];
  const propertyIds: bigint[] = [];
  const rooms: SeededRoom[] = [];
  const hash = await argon2.hash('Partner@2026', ARGON_OPTS);

  for (const spec of PARTNERS) {
    const partner = await prisma.partners.upsert({
      where: { email: spec.email },
      create: {
        email: spec.email,
        password_hash: hash,
        owner_name: spec.ownerName,
        phone: spec.phone,
        status: spec.status,
        bank_name: spec.bankName,
        bank_account: spec.bankAccount,
        commission_rate: new Prisma.Decimal('5.00'),
        created_at: daysAgo(spec.joinedDaysAgo),
      },
      update: {
        owner_name: spec.ownerName,
        phone: spec.phone,
        status: spec.status,
        bank_name: spec.bankName,
        bank_account: spec.bankAccount,
        created_at: daysAgo(spec.joinedDaysAgo),
      },
      select: { id: true },
    });
    partnerIds.push(partner.id);

    // Properties have no unique business key, so match on (partner, name).
    const p = spec.property;
    const existing = await prisma.properties.findFirst({
      where: { partner_id: partner.id, name: p.name },
      select: { id: true },
    });

    const property = existing
      ? await prisma.properties.update({
          where: { id: existing.id },
          data: {
            type: p.type,
            province: p.province,
            address: p.address,
            lat: new Prisma.Decimal(p.lat),
            lng: new Prisma.Decimal(p.lng),
            amenities: p.amenities,
          },
          select: { id: true },
        })
      : await prisma.properties.create({
          data: {
            partner_id: partner.id,
            name: p.name,
            type: p.type,
            province: p.province,
            address: p.address,
            lat: new Prisma.Decimal(p.lat),
            lng: new Prisma.Decimal(p.lng),
            amenities: p.amenities,
            photos: [],
            rating: new Prisma.Decimal(0),
            review_count: 0,
          },
          select: { id: true },
        });
    propertyIds.push(property.id);

    // Only verified partners are sellable, so only they get rooms.
    if (spec.status !== 'verified') continue;

    for (let i = 0; i < p.roomCount; i++) {
      const t = ROOM_TYPES[i % ROOM_TYPES.length];
      const roomNo = `ຫ້ອງ ${i + 1}`;
      const found = await prisma.rooms.findFirst({
        where: { property_id: property.id, room_no: roomNo },
        select: { id: true },
      });

      const room = found
        ? await prisma.rooms.update({
            where: { id: found.id },
            data: { name: t.name, has_ac: t.hasAc, bed_type: t.bedType, base_price: t.price, capacity: t.capacity },
            select: { id: true },
          })
        : await prisma.rooms.create({
            data: {
              property_id: property.id,
              name: t.name,
              room_no: roomNo,
              has_ac: t.hasAc,
              bed_type: t.bedType,
              base_price: t.price,
              capacity: t.capacity,
              qty: 1,
              is_active: true,
            },
            select: { id: true },
          });

      rooms.push({ id: room.id, propertyId: property.id, price: t.price, capacity: t.capacity });
    }
  }

  console.log(`  partners         ${partnerIds.length}  (${PARTNERS.filter((p) => p.status === 'pending').length} pending approval)`);
  console.log(`  properties       ${propertyIds.length}`);
  console.log(`  rooms            ${rooms.length}`);
  return { partnerIds, propertyIds, rooms };
}

async function seedCustomers(): Promise<bigint[]> {
  const hash = await argon2.hash('Customer@2026', ARGON_OPTS);
  const ids: bigint[] = [];

  for (const [i, c] of CUSTOMERS.entries()) {
    const user = await prisma.users.upsert({
      where: { email: c.email },
      create: {
        email: c.email,
        phone: c.phone,
        full_name: c.name,
        password_hash: hash,
        is_verified: true,
        tier: c.tier,
        points: c.points,
        status: c.status,
        created_at: daysAgo(300 - i * 30),
      },
      update: { full_name: c.name, phone: c.phone, tier: c.tier, points: c.points, status: c.status },
      select: { id: true },
    });
    ids.push(user.id);
  }
  console.log(`  customers        ${ids.length}`);
  return ids;
}

async function seedPromos(): Promise<bigint[]> {
  const ids: bigint[] = [];
  for (const p of PROMOS) {
    const promo = await prisma.promos.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        type: p.type,
        value: p.value,
        used_count: p.used,
        expires_at: addDays(new Date(), p.expiresInDays),
        is_active: p.expiresInDays > 0,
      },
      update: {
        type: p.type,
        value: p.value,
        used_count: p.used,
        expires_at: addDays(new Date(), p.expiresInDays),
        is_active: p.expiresInDays > 0,
      },
      select: { id: true },
    });
    ids.push(promo.id);
  }
  console.log(`  promos           ${ids.length}`);
  return ids;
}

interface SeededBooking {
  id: bigint;
  propertyId: bigint;
  status: string;
  checkOut: Date;
  userId: bigint;
}

/**
 * 90 days of booking history.
 *
 * Volume ramps up towards today so the GMV chart shows growth rather than
 * noise, and statuses follow the calendar: past stays are `done`, current ones
 * `staying`, future ones `confirmed`. A few are cancelled or awaiting payment.
 */
async function seedBookings(ctx: {
  propertyIds: bigint[];
  rooms: SeededRoom[];
  userIds: bigint[];
  promoIds: bigint[];
}): Promise<SeededBooking[]> {
  const { rooms, userIds, promoIds } = ctx;
  const out: SeededBooking[] = [];
  const today = daysAgo(0);

  for (let dayOffset = 90; dayOffset >= -20; dayOffset--) {
    const createdDay = daysAgo(dayOffset);

    // 0–4 bookings per day, weighted so recent days are busier.
    const recency = Math.max(0, (90 - dayOffset) / 90);
    const count = rand() < 0.25 ? 0 : between(1, Math.max(1, Math.round(1 + recency * 3)));

    for (let n = 0; n < count; n++) {
      const room = pick(rooms);
      const userId = pick(userIds);
      const nights = between(1, 4);

      // Stays start a little after the booking is made.
      const checkIn = addDays(createdDay, between(1, 14));
      const checkOut = addDays(checkIn, nights);

      const subtotal = room.price * nights;
      const fee = Math.round(subtotal * 0.05); // 5% service fee shown to the guest
      const total = subtotal + fee;

      const source: string = rand() < 0.22 ? 'walk_in' : 'app';
      const usePromo = rand() < 0.18;

      let status: string;
      if (rand() < 0.06) status = 'cancelled';
      else if (checkOut <= today) status = 'done';
      else if (checkIn <= today && checkOut > today) status = 'staying';
      else status = rand() < 0.12 ? 'pending' : 'confirmed';

      const booking = await prisma.bookings.create({
        data: {
          user_id: userId,
          property_id: room.propertyId,
          room_id: room.id,
          promo_id: usePromo ? pick(promoIds) : null,
          source,
          check_in: checkIn,
          check_out: checkOut,
          guests: between(1, room.capacity),
          subtotal,
          fee,
          total,
          status,
          created_at: atTime(createdDay, between(8, 21), between(0, 59)),
        },
        select: { id: true },
      });

      await prisma.booking_items.create({
        data: {
          booking_id: booking.id,
          room_id: room.id,
          nights,
          price_per_night: room.price,
        },
      });

      // Everything except a pending booking has been paid for.
      if (status !== 'pending') {
        await prisma.payments.create({
          data: {
            booking_id: booking.id,
            method: 'phajay_qr',
            idempotency_key: `seed-${booking.id}-${dayOffset}-${n}`,
            qr_payload: `00020101021238570010A00000072701270006PHAJAY0113${booking.id}5204599953031185802LA`,
            amount: total,
            status: status === 'cancelled' ? 'refunded' : 'paid',
            paid_at: atTime(createdDay, between(8, 22), between(0, 59)),
            txn_ref: `PJ${String(booking.id).padStart(8, '0')}`,
          },
        });
      } else {
        await prisma.payments.create({
          data: {
            booking_id: booking.id,
            method: 'phajay_qr',
            idempotency_key: `seed-${booking.id}-${dayOffset}-${n}`,
            qr_payload: `00020101021238570010A00000072701270006PHAJAY0113${booking.id}5204599953031185802LA`,
            amount: total,
            status: 'pending',
          },
        });
      }

      // Block the calendar for stays that are actually happening.
      if (status !== 'cancelled') {
        for (let d = 0; d < nights; d++) {
          const date = addDays(checkIn, d);
          await prisma.room_availability
            .upsert({
              where: { room_id_date: { room_id: room.id, date } },
              create: { room_id: room.id, date, price: room.price, status: 'booked' },
              update: { status: 'booked' },
            })
            .catch(() => undefined); // overlapping demo stays are harmless
        }
      }

      if (status === 'cancelled') {
        const fee30 = Math.round(total * 0.3);
        await prisma.cancellations.create({
          data: {
            booking_id: booking.id,
            reason: pick(['ປ່ຽນແຜນການເດີນທາງ', 'ຈອງຜິດວັນ', 'ເຫດສຸກເສີນ']),
            fee: fee30,
            refund_amount: total - fee30,
            created_at: atTime(addDays(createdDay, 1), 10, 0),
          },
        });
      }

      out.push({ id: booking.id, propertyId: room.propertyId, status, checkOut, userId });
    }
  }

  console.log(`  bookings         ${out.length}`);
  return out;
}

/** Reviews on completed stays, then property ratings recalculated to match. */
async function seedReviews(bookings: SeededBooking[]) {
  const done = bookings.filter((b) => b.status === 'done');
  const chosen = done.filter(() => rand() < 0.35).slice(0, 40);

  for (const [i, b] of chosen.entries()) {
    const r = REVIEW_TEXTS[i % REVIEW_TEXTS.length];
    await prisma.reviews.create({
      data: {
        booking_id: b.id,
        property_id: b.propertyId,
        stars: r.stars,
        text: r.text,
        is_flagged: r.flagged,
        is_hidden: false,
      },
    });
  }

  const grouped = await prisma.reviews.groupBy({
    by: ['property_id'],
    where: { is_hidden: false },
    _avg: { stars: true },
    _count: true,
  });
  for (const g of grouped) {
    await prisma.properties.update({
      where: { id: g.property_id },
      data: {
        rating: new Prisma.Decimal((g._avg.stars ?? 0).toFixed(2)),
        review_count: g._count,
      },
    });
  }

  console.log(`  reviews          ${chosen.length}  (${chosen.filter((_, i) => REVIEW_TEXTS[i % REVIEW_TEXTS.length].flagged).length} flagged)`);
}

/**
 * Weekly payouts for the four most recent completed weeks, computed from real
 * `done` bookings so the figures on the payout screen tie back to the bookings
 * screen exactly.
 */
async function seedPayouts(propertyIds: bigint[]) {
  const partnerOf = new Map<string, bigint>();
  const props = await prisma.properties.findMany({
    where: { id: { in: propertyIds } },
    select: { id: true, partner_id: true },
  });
  for (const p of props) partnerOf.set(p.id.toString(), p.partner_id);

  let created = 0;

  for (let weeksBack = 1; weeksBack <= 4; weeksBack++) {
    const start = weekStart(daysAgo(weeksBack * 7));
    const end = addDays(start, 6);
    const endExclusive = addDays(end, 1);

    const bookings = await prisma.bookings.findMany({
      where: { status: 'done', check_out: { gte: start, lt: endExclusive } },
      select: { total: true, source: true, property_id: true },
    });

    const perPartner = new Map<string, { gmv: number; commission: number }>();
    for (const b of bookings) {
      const partnerId = partnerOf.get(b.property_id.toString());
      if (!partnerId) continue;
      const rate = b.source === 'walk_in' ? 2.5 : 5;
      const acc = perPartner.get(partnerId.toString()) ?? { gmv: 0, commission: 0 };
      acc.gmv += b.total;
      acc.commission += Math.round((b.total * rate) / 100);
      perPartner.set(partnerId.toString(), acc);
    }

    for (const [partnerId, acc] of perPartner) {
      await prisma.payouts.create({
        data: {
          partner_id: BigInt(partnerId),
          period_start: start,
          period_end: end,
          gmv: acc.gmv,
          commission: acc.commission,
          net_amount: acc.gmv - acc.commission,
          // Only the most recent week is still awaiting transfer.
          status: weeksBack === 1 ? 'pending' : 'paid',
          paid_at: weeksBack === 1 ? null : atTime(addDays(end, 2), 10, 30),
        },
      });
      created++;
    }
  }

  console.log(`  payouts          ${created}`);
}

async function seedNotifications(partnerIds: bigint[], userIds: bigint[]) {
  const rows: Prisma.notificationsCreateManyInput[] = [
    {
      recipient_type: 'partner',
      recipient_id: partnerIds[0],
      title: 'ຄຳຂໍຈອງໃໝ່',
      body: 'ນາງ ຈັນທະ ຂໍຈອງ Deluxe Garden View · 12–15 ກ.ຄ.',
      type: 'booking',
      created_at: atTime(daysAgo(0), 9, 12),
    },
    {
      recipient_type: 'partner',
      recipient_id: partnerIds[0],
      title: 'ໂອນເງິນສຳເລັດ',
      body: 'ຖອນ ₭2,187,600 ເຂົ້າບັນຊີ BCEL ***4192 ແລ້ວ',
      type: 'payment',
      created_at: atTime(daysAgo(0), 7, 40),
      is_read: true,
    },
    {
      recipient_type: 'partner',
      recipient_id: partnerIds[1],
      title: 'ຣີວິວໃໝ່ 5 ດາວ',
      body: '"ທີ່ພັກສະອາດ ເຈົ້າຂອງໃຈດີມາກ" — ນາງ ມະລິ',
      type: 'review',
      created_at: atTime(daysAgo(1), 18, 5),
    },
    {
      recipient_type: 'user',
      recipient_id: userIds[0],
      title: 'ຢືນຢັນການຈອງແລ້ວ',
      body: 'ການຈອງຂອງທ່ານທີ່ ວິນເທດ ໂຮມສະເຕ ຖືກຢືນຢັນແລ້ວ',
      type: 'booking',
      created_at: atTime(daysAgo(2), 14, 32),
    },
    {
      recipient_type: 'user',
      recipient_id: userIds[3],
      title: 'ໂຄ້ດສ່ວນຫຼຸດໃໝ່ 🎟️',
      body: 'ໃຊ້ໂຄ້ດ BOUN2026 ຫຼຸດທັນທີ ₭150,000',
      type: 'promo',
      created_at: atTime(daysAgo(3), 11, 0),
    },
  ];

  await prisma.notifications.createMany({ data: rows });
  console.log(`  notifications    ${rows.length}`);
}

async function seedAuditLogs(adminIds: bigint[]) {
  const rows: Prisma.audit_logsCreateManyInput[] = [
    { actor_type: 'admin', actor_id: adminIds[0], action: 'login', target: `admins:${adminIds[0]}`, ip_address: '110.78.146.22', created_at: atTime(daysAgo(0), 8, 2) },
    { actor_type: 'admin', actor_id: adminIds[1], action: 'payout_pay_all', target: 'payouts', ip_address: '110.78.146.31', created_at: atTime(daysAgo(7), 10, 30) },
    { actor_type: 'admin', actor_id: adminIds[0], action: 'approve_partner', target: 'partners:1', ip_address: '110.78.146.22', created_at: atTime(daysAgo(12), 15, 44) },
    { actor_type: 'admin', actor_id: adminIds[2], action: 'review_hide', target: 'reviews:2', ip_address: '110.78.146.55', created_at: atTime(daysAgo(4), 9, 18) },
    { actor_type: 'admin', actor_id: adminIds[1], action: 'settings_update', target: 'app_settings', ip_address: '110.78.146.31', created_at: atTime(daysAgo(20), 16, 5) },
  ];
  await prisma.audit_logs.createMany({ data: rows });
  console.log(`  audit_logs       ${rows.length}`);
}

async function printSummary() {
  const [bookings, revenue, pendingPayouts, pendingApprovals] = await Promise.all([
    prisma.bookings.count(),
    prisma.bookings.aggregate({
      where: { status: { in: ['confirmed', 'staying', 'done'] } },
      _sum: { total: true },
    }),
    prisma.payouts.aggregate({ where: { status: 'pending' }, _sum: { net_amount: true }, _count: true }),
    prisma.partners.count({ where: { status: 'pending' } }),
  ]);

  const password = process.env.SEED_ADMIN_PASSWORD ?? 'LaoStay@2026';

  console.log('');
  console.log('─'.repeat(64));
  console.log('  Seed complete');
  console.log('─'.repeat(64));
  console.log(`  bookings               ${bookings}`);
  console.log(`  gross booking value    ₭${(revenue._sum.total ?? 0).toLocaleString('en-US')}`);
  console.log(`  payouts awaiting pay   ${pendingPayouts._count}  (₭${(pendingPayouts._sum.net_amount ?? 0).toLocaleString('en-US')})`);
  console.log(`  partners awaiting OK   ${pendingApprovals}`);
  console.log('');
  console.log('  Log in to the WebAdmin with:');
  for (const a of ADMINS) console.log(`    ${a.email.padEnd(26)} ${a.role.padEnd(12)} ${password}`);
  console.log('─'.repeat(64));
}

function maskDbUrl(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@').split('?')[0];
}

main()
  .catch((e) => {
    console.error('\nSeed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

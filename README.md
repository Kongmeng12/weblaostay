# LaoStay

ແພລດຟອມຈອງທີ່ພັກລາວ — Backend (NestJS) + WebAdmin (React) + ເວັບລູກຄ້າ (React) + Partner app (Flutter).

```
kong/                         ← repo ນີ້
├─ backend/     NestJS API      → http://localhost:3100/api
│                 · /api/properties     ຄົ້ນຫາ (ບໍ່ຕ້ອງ login)
│                 · /api/customer/*     ແຂກ
│                 · /api/partner/*      ເຈົ້າຂອງທີ່ພັກ
│                 · /api/admin/*        ຜູ້ດູແລ
├─ webadmin/    React + Vite    → http://localhost:5173   ຜູ້ດູແລ
└─ webapp/      React + Vite    → http://localhost:5174   ແຂກ

../partner_app/  Flutter        ຢູ່ນອກ repo ນີ້ ມີ repo ຂອງຕົນເອງ
```

## ເລີ່ມໃຊ້ງານ

ຄັ້ງທຳອິດ:

```bash
cd d:\kong\laostay\kong
cp backend/.env.example backend/.env    # ແລ້ວໃສ່ DATABASE_URL ແລະ JWT secret
npm run setup                            # ຕິດຕັ້ງທັງ 4 ໂປຣເຈັກ + generate Prisma client
npm run db:reset -- --yes                # ສ້າງ schema + ຂໍ້ມູນຕົວຢ່າງ (ລຶບຂອງເກົ່າໝົດ)
```

ຈາກນັ້ນທຸກຄັ້ງ:

```bash
npm run dev        # API :3100 + WebAdmin :5173 + ເວັບລູກຄ້າ :5174
```

ບັນຊີຕົວຢ່າງ — ທຸກຄົນເຂົ້າຜ່ານ `POST /api/auth/login` ອັນດຽວກັນ,
ແອັບແຕ່ລະໂຕກວດ `role` ເອງ:

| ອີເມວ | ເປັນໃຜ | ລະຫັດຜ່ານ |
|---|---|---|
| `amnuay@laostay.la` | super_admin | `LaoStay@2026` |
| `bounmy@laostay.la` | finance | `LaoStay@2026` |
| `phonsy@laostay.la` | staff | `LaoStay@2026` |
| `vintage@laostay.la` | partner (verified) | `Partner@2026` |
| `homsabay@laostay.la` | partner (verified) | `Partner@2026` |
| `newapplicant@laostay.la` | partner (ລໍອະນຸມັດ) | `Partner@2026` |
| `souda.v@gmail.com` | ແຂກ | `Customer@2026` |

> **ໝາຍເຫດ port**: ໃຊ້ **3100** ບໍ່ແມ່ນ 3000 ເພາະ 3000 ຖືກໃຊ້ໂດຍໂປຣເຈັກອື່ນໃນເຄື່ອງນີ້.
> ປ່ຽນໄດ້ທີ່ `backend/.env` (`PORT`) ພ້ອມ proxy ໃນ `webadmin/vite.config.ts`
> ແລະ `webapp/vite.config.ts`.

### ຄຳສັ່ງ (ແລ່ນຈາກ root)

| ຄຳສັ່ງ | ເຮັດຫຍັງ |
|---|---|
| `npm run dev` | ແລ່ນ API + WebAdmin + ເວັບລູກຄ້າ ພ້ອມກັນ |
| `npm run setup` | ຕິດຕັ້ງ dependency ທັງໝົດ + generate Prisma client |
| `npm run typecheck` | ກວດ type ທັງ 3 ໂປຣເຈັກ |
| `npm run build` | build ທັງ 3 ໂປຣເຈັກ |
| `npm run smoke` | ທົດສອບ API 112 ຂໍ້ (ຕ້ອງມີ API ແລ່ນຢູ່) |
| `npm run studio` | ເປີດ Prisma Studio |

## ຖານຂໍ້ມູນ

PostgreSQL (Neon) + PostGIS — **schema v2: 59 ຕາຕະລາງ · 205 index · 39 enum · 33 trigger**.

```bash
cd backend
npm run db:reset -- --yes   # DROP SCHEMA public CASCADE ແລ້ວສ້າງໃໝ່ທັງໝົດ
npm run db:pull             # introspect → prisma/schema.prisma
npm run db:generate         # ສ້າງ Prisma client
```

> `db:reset` **ລຶບທຸກຢ່າງ** ແລະ ບໍ່ມີທາງກັບຄືນ. ຕ້ອງໃສ່ `-- --yes` ເອງ
> ແລະ ມັນຈະປະຕິເສດເມື່ອ `NODE_ENV=production`.

SQL ຢູ່ `backend/prisma/migrations-v2/` ແລ່ນຕາມລຳດັບຊື່ໄຟລ໌:

| ໄຟລ໌ | ເນື້ອໃນ |
|---|---|
| `0001_schema_v2.sql` | 59 ຕາຕະລາງ · enum · CHECK ທັງໝົດ |
| `0002_indexes.sql` | 205 index — ລວມ GiST (geo) ແລະ GIN (full-text) |
| `0003_triggers.sql` | `updated_at` ອັດຕະໂນມັດ · ຄິດຄະແນນທີ່ພັກຄືນ · ອັບເດດ preview ຂອງແຊັດ |
| `0004_master_data.sql` | 18 ແຂວງ · 56 ເມືອງ · 30 ສິ່ງອຳນວຍ · 4 ນະໂຍບາຍຍົກເລີກ |
| `0005_demo_data.sql` | ບັນຊີ · ທີ່ພັກ · ຄັງຫ້ອງ 90 ວັນ · 60 ການຈອງ · ledger |
| `0006_settings_cms.sql` | `system_settings` · notification template · ໜ້າ CMS · FAQ |

> `0006` ແຍກອອກມາຈາກ `0004` ໂດຍເຈດຕະນາ: ທຸກຕາຕະລາງໃນນັ້ນມີ FK ຫາ `users`
> ແລະ `0005` ໃຊ້ `TRUNCATE users CASCADE` ເຊິ່ງລາມໄປລຶບພວກມັນຫາຍງຽບໆ.

### ສາມຢ່າງທີ່ຖືເປັນຫົວໃຈ

1. **ຄັງຫ້ອງກັນການຂາຍເກີນ** — `room_inventory` ມີ `total_count` / `held_count` /
   `booked_count`, `available_count` ເປັນ **generated column**, ພ້ອມ CHECK
   `held + booked <= total`. ການຈອງລັອກແຖວດ້ວຍ `FOR UPDATE` ໃນ statement ດຽວ.
2. **Hold ໝົດອາຍຸເອງ** — ຈອງແລ້ວບໍ່ຈ່າຍ ຫ້ອງກັນໄວ້ 15 ນາທີ ແລ້ວ cron
   (`hold-sweeper.service.ts`) ຄືນໃຫ້. ບໍ່ມີອັນນີ້ ຫ້ອງຈະຄ້າງຕະຫຼອດໄປ.
3. **Ledger ສອງດ້ານ** — `ledger_entries` ບັນທຶກ charge / commission / refund / payout.
   `balance_after` ເປັນຄວາມສະດວກເທົ່ານັ້ນ — **`SUM(amount)` ຄືຄວາມຈິງ**.

## ການຊຳລະ · PhaJay

QR ມາຈາກ PhaJay ໂດຍກົງ (`Generate QR`) ບໍ່ແມ່ນເຮົາສ້າງເອງ — ແຂກ **ສະແກນຈ່າຍໄດ້ເລີຍ**
ບໍ່ຕ້ອງເລືອກທະນາຄານ. ຢູ່ [phajay.provider.ts](backend/src/payments/phajay.provider.ts) ໄຟລ໌ດຽວ.

| env | |
|---|---|
| `PHAJAY_API_KEY` | key ດຽວ ໃຊ້ໄດ້ໝົດ — ສົ່ງເປັນ header `secretKey` |
| `PHAJAY_WEBHOOK_SECRET` | ລະຫັດລັບໃນ URL ຂອງ webhook — **ບໍ່ມີ = ປະຕິເສດທຸກ callback** |
| `PHAJAY_BANK` | `bcel` · `jdb` · `ldb` · `ib` · `stb` · `m_money` |

Sandbox ຫຼື ຂອງຈິງ ຕັດສິນດ້ວຍ `NODE_ENV` — ບໍ່ມີສະວິດໃຫ້ຕັ້ງຜິດ. ເຄື່ອງພັດທະນາແຕະເງິນຈິງບໍ່ໄດ້ເລີຍ.

> ⚠️ endpoint ຂອງຈິງກັບ sandbox ຕ່າງກັນແຄ່ `/v1/api/**test**/payment/…` — ແລະ **test key
> ຢູ່ endpoint ຈິງຫັກເງິນຈິງ** (ຈຳກັດ 999 ກີບ, 20 ຄັ້ງ/ວັນ). ຄ່າເລີ່ມຕົ້ນຈຶ່ງເປັນ sandbox.

ຍັງເຫຼືອກ່ອນຮັບເງິນຈິງ: ຕັ້ງ **Webhook URL** ໃນ portal ເປັນ
`https://<domain>/api/payments/phajay/webhook/<PHAJAY_WEBHOOK_SECRET>` (ຕ້ອງ deploy ກ່ອນ).

## ຟອນ

Noto Sans Lao **ມາພ້ອມກັບແອັບ** (`@fontsource/noto-sans-lao`) ບໍ່ໄດ້ໂຫຼດຈາກ Google.
ນຳເຂົ້າຢູ່ `src/main.tsx` ຂອງແຕ່ລະເວັບ, ນ້ຳໜັກ 400–800 ໃຫ້ຕົງກັບ `f()` ໃນ `theme.ts`.

ເປັນຫຍັງ: ບໍ່ຕ້ອງລໍ `fonts.googleapis.com` ຕອນເປີດຄັ້ງທຳອິດ · ບໍ່ມີຕົວອັກສອນກະພິບປ່ຽນຮູບ ·
ໃຊ້ໄດ້ເຖິງເນັດຊ້າ. ແຕ່ລະໄຟລ໌ມີ `unicode-range` ຂອງຕົນເອງ ຈຶ່ງໂຫຼດສະເພາະທີ່ໜ້ານັ້ນໃຊ້ຈິງ.

## ເອກະສານ

- [docs/CUSTOMER_API.md](docs/CUSTOMER_API.md) — ສັນຍາ API ສຳລັບຄົນສ້າງແອັບລູກຄ້າ Flutter.
  ທຸກຕົວຢ່າງເປັນ response ຈິງ; ສ້າງໃໝ່ດ້ວຍ `npm --prefix backend run capture:api`.

## ການທົດສອບ

ເປີດ server ດ້ວຍ `npm run dev` (terminal ໜຶ່ງ) ແລ້ວ:

```bash
npm run check      # ທຸກຢ່າງ ຮຽງກັນ — ຢຸດທັນທີເມື່ອອັນໃດຕົກ
```

**`check` ຂຽນລົງ DB**: ຈອງ · ຈ່າຍ · ຍົກເລີກ · payout · ຂໍ້ຄວາມແຊັດ.
ຢາກແລ່ນເປັນສ່ວນໆ:

```bash
# Backend
cd backend
npm run check:storage                    # 16 ຂໍ້, ບໍ່ຕ້ອງມີ server ຫຼື DB
npm run check:phajay                     # 27 ຂໍ້, ບໍ່ຕ້ອງມີເນັດ ຫຼື DB
npm run smoke                            # 112 ຂໍ້ — ຕ້ອງມີ API ແລ່ນຢູ່, ຂຽນລົງ DB ຈິງ

# ເວັບລູກຄ້າ — ຂັບ browser ຈິງ
cd webapp
npm run check:browse                     # 21 ຂໍ້, ອ່ານຢ່າງດຽວ (ລວມ FAQ + ໜ້າຄົງທີ່)
npm run check:chat                       # 19 ຂໍ້ ແຊັດ + ຕອບຮີວິວ, ຂຽນລົງ DB
npm run check:journey                    # ຈອງຈົນຈົບ, ຂຽນລົງ DB

# WebAdmin
cd ../webadmin
npm run check:responsive                 # 17 ໜ້າ × 8 ຂະໜາດຈໍ, ອ່ານຢ່າງດຽວ
npm run check:cms                        # 14 ຂໍ້, ຂຽນລົງ DB ແລ້ວລຶບຄືນ

# Partner app
cd ../../partner_app
flutter test                             # 31 ຂໍ້ offline
flutter test --tags live --run-skipped   # 12 ຂໍ້ ຕໍ່ API ຈິງ
```

`smoke` ກວດສິ່ງທີ່ສຳຄັນທີ່ສຸດ: **ຈອງພ້ອມກັນຈົນເຕັມ → ອັນຖັດໄປໄດ້ 409** ແລະ
`held + booked ≤ total` ຍັງຈິງ · hold ໝົດອາຍຸແລ້ວ sweeper ຄືນຫ້ອງ · ຈ່າຍແລ້ວ ledger ໄດ້ 2 ແຖວ ·
ຍົກເລີກແລ້ວ `penalty + refund = ຈ່າຍມາ` · payout = ຜົນລວມ `payout_items` ·
partner B ໄດ້ 404 ຢູ່ທຸກຢ່າງຂອງ partner A · bcrypt ຂອງ seed login ໄດ້ແລ້ວ hash ກາຍເປັນ argon2.

ຈົບແລ້ວກວດ 8 invariant ໃນ DB ໂດຍກົງ (ບໍ່ຄວນມີແຖວໃດ), ເຊັ່ນ:

```sql
SELECT count(*) FROM room_inventory WHERE held_count + booked_count > total_count;
```

## ສະຖາປັດຕະຍະກຳ

### Backend

- **Prisma ຈາກ `db pull`** — ບໍ່ໃຊ້ `migrate dev`. SQL ຢູ່ `migrations-v2/` ຄືແຫຼ່ງຄວາມຈິງ;
  CHECK ແລະ generated column ຫຼາຍອັນ Prisma ສະແດງບໍ່ໄດ້.
- **`users` ຕາຕະລາງດຽວ** ພ້ອມ `role` (CUSTOMER/PARTNER/ADMIN) + `admin_role`.
  ຈຶ່ງມີ **JWT strategy ອັນດຽວ** ແລະ login endpoint ອັນດຽວ.
- **argon2id** ສຳລັບລະຫັດໃໝ່; hash bcrypt ເກົ່າຍັງ login ໄດ້ ແລ້ວຖືກຂຽນທັບເປັນ argon2 ທັນທີ.
- **RBAC** `@Roles()` + `@AdminRoles()` — guard ເປັນ global, route ຕ້ອງ `@Public()` ຈຶ່ງເປີດ.
  **ບໍ່ໃສ່ `@Roles` = ເປີດໃຫ້ທຸກຄົນທີ່ login ແລ້ວ.**
- **`@Audit()`** interceptor ຂຽນ `audit_logs` ພ້ອມ IP ຫຼັງ handler ສຳເລັດ.
- **ເງິນເປັນ `bigint` ກີບລ້ວນ** (`src/common/money.ts`) — net ຄິດຈາກການລົບສະເໝີ.
  ອອກ API ເປັນ `number` ຜ່ານ `kipOf()`; id ຍັງເປັນ string.
- **ວັນທີ່ເປັນ UTC ລ້ວນ** (`src/common/dates.ts`) — ອ່ານກ່ອນແກ້ໂຄດທີ່ແຕະ `date` column.
- **ລາຄາຄິດບ່ອນດຽວ** (`src/booking/pricing.service.ts`) — ແຂກ ແລະ walk-in ໃຊ້ `quote()` ອັນດຽວກັນ.

### ຈຸດທີ່ພາດງ່າຍ (ເຄີຍພາດມາແລ້ວ)

- **`date` column + timezone.** Prisma ຂຽນ `date` ໂດຍເອົາ **UTC day** ຂອງ JS Date —
  `new Date(2026,6,13)` (local midnight) ຢູ່ UTC+7 ຈະລົງ DB ເປັນວັນທີ 12.
  ແລະ `pg` ອ່ານ `date` ຈາກ raw query ອອກມາເປັນ **local** midnight ຂະນະທີ່ Prisma ໃຫ້ UTC midnight
  → key ບໍ່ກົງກັນ 1 ວັນ. ໃຊ້ helper ໃນ `dates.ts` ສະເໝີ, raw query ໃຫ້ຄືນ
  `to_char(..., 'YYYY-MM-DD')` ເປັນ text.
- **BigInt.** ທຸກ `id` ເປັນ `int8` → `JSON.stringify` ບໍ່ໄດ້. `BigIntInterceptor` ແປງເປັນ
  string ຂາອອກ. ເງິນກໍເປັນ bigint ຄືກັນ ຈຶ່ງຕ້ອງຜ່ານ `kipOf()` ໃຫ້ເປັນ number ກ່ອນ
  ບໍ່ດັ່ງນັ້ນ client ຈະໄດ້ຮັບເງິນເປັນ string.
- **ຫ້າມຂຽນ `available_count`.** ມັນເປັນ generated column ແຕ່ Prisma introspect ອອກມາເປັນ
  ຖັນທຳມະດາ — ຂຽນໃສ່ແລ້ວ Postgres error ຕອນ runtime. ອັບເດດແຕ່ອີກ 3 ຖັນ.
- **`geog` ແລະ `search_vector` ເປັນ `Unsupported`** — Prisma query ບໍ່ໄດ້.
  ຄົ້ນຫາ "ໃກ້ຂ້ອຍ" ແລະ full-text **ຕ້ອງໃຊ້ `$queryRaw`**.
- **`TRUNCATE ... CASCADE` ລາມໄປຫາຕາຕະລາງທີ່ມີ FK ຫາມັນ** — ບັກນີ້ເຄີຍລຶບ master data ຫາຍງຽບໆ.
- **ລະຫັດການຈອງເປັນ hex.** `STL-0142` = id 322. ໂຄ້ດ hex ທີ່ເປັນຕົວເລກລ້ວນຄືກັນກັບ id
  ທຳມະດາ — `parseBookingRef` ຈຶ່ງຄືນ **ສອງຄ່າ** ແລ້ວ query ດ້ວຍ `IN`.
- **ຢ່າຖືເວລາໃນ transaction ການຈອງ.** ຕັ້ງແຕ່ `hold()` ເປັນຕົ້ນໄປ ທຸກຄົນທີ່ຈອງຫ້ອງນັ້ນຄືນນັ້ນ
  ລໍຢູ່ຂ້າງຫຼັງ ແລະ ແຕ່ລະ statement ຄື round-trip ໄປ Neon ອີກຄັ້ງ. ອ່ານລາຄາ, ນະໂຍບາຍ,
  ຊື່ແຂກ, booking id **ກ່ອນ** ເປີດ transaction; ສົ່ງແຈ້ງເຕືອນ **ຫຼັງ** commit.
  ບໍ່ດັ່ງນັ້ນຈອງພ້ອມກັນ 9 ຄົນຈະຊົນ 20 ວິນາທີແລ້ວໄດ້ 500.
- **Webhook ຕ້ອງໃຊ້ raw body.** ລາຍເຊັນ HMAC ຄິດຈາກ byte ທີ່ຜູ້ໃຫ້ບໍລິການສົ່ງມາ; JSON ທີ່
  parse ແລ້ວ serialize ຄືນ ລຳດັບ key ຈະປ່ຽນ ແລະ ລາຍເຊັນຈະບໍ່ກົງຈັກເທື່ອ.
  `main.ts` ຈຶ່ງເປີດ `rawBody: true`.
- **ຈຳກັດ login ຕ້ອງສູງກວ່າ `login_max_attempts`.** ຖ້າ throttle ຕ່ຳກວ່າ ຫຼື ເທົ່າກັນ
  ມັນຈະຍິງກ່ອນ ແລ້ວການລັອກບັນຊີຈະບໍ່ມີວັນເຮັດວຽກ.

### ໜ້າເວັບ

WebAdmin ແລະ ເວັບລູກຄ້າໃຊ້ stack ດຽວກັນ: React 19 + Vite + TanStack Query,
inline style ພ້ອມ token ສີຢູ່ `src/theme.ts`, ບໍ່ໃຊ້ UI library.

`src/lib/api.ts` (ທັງສອງ) ຈັດການ 401 ດ້ວຍການ refresh 1 ຄັ້ງແລ້ວຍິງຄຳຂໍເດີມຄືນ.
ຄຳຂໍທີ່ 401 ພ້ອມກັນຫຼາຍອັນ **ຕ້ອງ** ໃຊ້ refresh promise ອັນດຽວກັນ — backend ຖື
refresh token ທີ່ໃຊ້ຊ້ຳວ່າຖືກລັກ ແລ້ວຈະ revoke ທຸກ session ຂອງບັນຊີນັ້ນ.

ເວັບລູກຄ້າມີ QR encoder ຂອງຕົນເອງ (`components/QrCode.tsx`) ບໍ່ດຶງ dependency —
ໜ້າຮັບເງິນບໍ່ຄວນຂຶ້ນກັບ npm advisory ອັນດຽວ.

## ການຊຳລະ (PhaJay)

`PAYMENT_PROVIDER` ໃນ `backend/.env` ເລືອກລະຫວ່າງສອງອັນ:

- **`simulated`** (ຄ່າເລີ່ມຕົ້ນ) — ສ້າງ QR ຮູບແບບ EMVCo ຈິງ ແຕ່ບໍ່ມີທະນາຄານ.
  ຢືນຢັນການຈ່າຍດ້ວຍ `POST /api/payments/dev/settle/:paymentId` ເຊິ່ງເຊັນ callback
  ດ້ວຍກະແຈອັນດຽວກັບ webhook ຈິງ — ເສັ້ນທາງທີ່ທົດສອບຈຶ່ງເປັນເສັ້ນທາງ production.
  ເລືອກອັນນີ້ຕອນ `NODE_ENV=production` ຈະ log error ດັງໆຕອນ boot.
- **`phajay`** — ຂອງຈິງ. ໃສ່ `PHAJAY_*` ໃນ `.env` ແລ້ວປ່ຽນຄ່ານີ້.

**ເມື່ອໄດ້ spec ຈາກ acquirer ແລ້ວ ໃຫ້ແກ້ໄຟລ໌ດຽວ**: `src/payments/phajay.provider.ts`.

## ຮູບ

ອັບຜ່ານ `POST /api/partner/properties/:id/photos` (multipart, field `file`).
ຮັບ JPEG/PNG/WebP ≤ 5 MB, ສູງສຸດ 12 ຮູບຕໍ່ທີ່ພັກ, ກວດ magic byte ບໍ່ແມ່ນພຽງ mime ທີ່ client ບອກ,
ຊື່ໄຟລ໌ສ້າງໃໝ່ສະເໝີ. ເກັບຢູ່ `backend/uploads/` ແລ້ວ serve ທີ່ `/uploads/...`.

ບ່ອນເກັບເລືອກດ້ວຍ `STORAGE_PROVIDER`:

| ຄ່າ | ໄຟລ໌ໄປໃສ | ເໝາະເມື່ອ |
|---|---|---|
| `local` (ຄ່າເລີ່ມຕົ້ນ) | `backend/uploads/` ແລະ process ນີ້ serve ເອງ | VPS ໜຶ່ງເຄື່ອງ ທີ່ disk ບໍ່ຫາຍ |
| `r2` | bucket ແບບ S3 — Cloudflare R2, AWS S3, MinIO | ຫຼາຍກວ່າ 1 instance ຫຼື disk ຫາຍຕອນ deploy |

ຕັ້ງ `r2` ແລ້ວ key `S3_*` ຂາດ → **process ບໍ່ start** ບໍ່ແມ່ນຕົກກັບໄປໃຊ້ disk ງຽບໆ.
ຄ່າທັງໝົດອະທິບາຍໄວ້ໃນ [.env.example](backend/.env.example).

> `local` ໃນ production **deploy ຫຼາຍ instance ບໍ່ໄດ້** ແລະ ຮູບຫາຍເມື່ອ container ຖືກສ້າງໃໝ່ —
> boot ຈະ log ເປັນ ERROR ເຕືອນໄວ້. ແລະ backup ຕ້ອງລວມໂຟນເດີ `uploads/` ນຳ ເພາະ dump ຂອງ DB ບໍ່ມີມັນ.

## ຂອບເຂດປັດຈຸບັນ

| ສ່ວນ | ສະຖານະ |
|---|---|
| Schema v2 (59 ຕາຕະລາງ) | ✅ |
| Auth + RBAC + audit | ✅ |
| ຄົ້ນຫາ · ຈອງ · hold · ຈ່າຍ · ຍົກເລີກ · payout · ledger | ✅ |
| Admin API + WebAdmin (17 ໜ້າຈໍ) | ✅ |
| Partner API + Flutter partner app | ✅ |
| Customer API + ເວັບລູກຄ້າ | ✅ |
| QR PhaJay | ✅ ຕໍ່ແລ້ວ — sandbox ໃຊ້ໄດ້, ລໍ webhook URL ຈິງ |
| ສົ່ງ SMS / ອີເມວ | ⬜ **ບໍ່ມີເລີຍ** — OTP ແລະ ກູ້ລະຫັດຜ່ານໃຊ້ບໍ່ໄດ້ໃນ production |
| ເກັບຮູບໃສ່ S3/R2 | ✅ ໂຄດພ້ອມ — ຕັ້ງ `STORAGE_PROVIDER=r2` ເມື່ອມີ bucket |
| Deploy · CI | ⬜ **ບໍ່ເຄີຍ deploy** |
| Coupon · ໂປຣໂມຊັນ | ⬜ ມີແຕ່ schema — `discountAmount` ຍັງເປັນ 0 |
| ແຈ້ງເຕືອນຈາກ template (`NotificationsService`) | ✅ |
| ແຊັດ — API · ເວັບລູກຄ້າ · Flutter partner | ✅ |
| ຕອບຮີວິວ (threaded) | ✅ |
| CMS — banner · ປະກາດ · FAQ · ໜ້າຄົງທີ່ | ✅ ຈັດການໃນ WebAdmin, ອ່ານໃນເວັບລູກຄ້າ |
| Push / device token | ⬜ ຍັງບໍ່ມີ — ລໍການເລືອກ vendor ຄືກັນກັບ SMS |
| Unit test backend | ⬜ ມີແຕ່ smoke |
| ແອັບລູກຄ້າ Flutter | ⬜ ຮອບໜ້າ |

ຕາຕະລາງທີ່ຍັງບໍ່ມີໂຄດແຕະເຫຼືອ **7** ຈາກ 59 (ບໍ່ນັບ `spatial_ref_sys` ຂອງ PostGIS):
`coupons` · `coupon_usages` · `promotion_partners` · `promotion_properties` ·
`promotion_room_types` · `message_attachments` · `user_device_tokens` —
ຄື coupon/ໂປຣໂມຊັນ (P2), ໄຟລ໌ແນບໃນແຊັດ ແລະ push token.
ແຜນລະອຽດຢູ່ໃນແຜນວຽກຂອງໂປຣເຈັກ.

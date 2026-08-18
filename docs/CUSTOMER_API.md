# LaoStay — Customer API

ເອກະສານສຳລັບຄົນສ້າງ **ແອັບລູກຄ້າ Flutter**. ທຸກຕົວຢ່າງໃນນີ້ຄື response ຈິງທີ່ດຶງມາຈາກ server
ບໍ່ແມ່ນຕົວຢ່າງທີ່ຂຽນຂຶ້ນເອງ.

Base URL — `https://<host>/api`
ຢູ່ເຄື່ອງພັດທະນາ: `http://localhost:3100/api`

ເອກະສານນີ້ຄຸມສະເພາະສິ່ງທີ່ **ແອັບລູກຄ້າ** ໃຊ້. Partner app ແລະ WebAdmin ໃຊ້ຄົນລະຊຸດ
(`/partner/*`, `/admin/*`) ແລະ ບໍ່ຢູ່ໃນນີ້.

---

## 1 · ກົດ 6 ຂໍ້ທີ່ຕ້ອງຮູ້ກ່ອນຂຽນໂຄດ

**1 · id ທຸກອັນເປັນ string ບໍ່ແມ່ນ int**
`"id": "121"` — DB ໃຊ້ `bigint` ເຊິ່ງໃຫຍ່ກວ່າ `int` ຂອງ JSON. ໃນ Dart ໃຫ້ເປັນ `String`
ຕະຫຼອດ. ຢ່າ `int.parse()` ແລ້ວສົ່ງກັບມາເປັນຕົວເລກ.

**2 · ເງິນເປັນ int ກີບເຕັມ ບໍ່ມີທົດສະນິຍົມ**
`"total": 1058400` ໝາຍເຖິງ ₭1,058,400. ບໍ່ມີ ₭0.50 ໃນລາວ ຈຶ່ງບໍ່ມີສ່ວນທົດ.
ໃນ Dart ໃຊ້ `int`. **ຢ່າໃຊ້ `double`** — ຄິດໄລ່ແລ້ວຈະເພີ້ຽນ.

**3 · ວັນທີ່ມີສອງແບບ ຢ່າສັບສົນ**

| ຮູບແບບ | ໃຊ້ບ່ອນ | ຕົວຢ່າງ |
|---|---|---|
| `YYYY-MM-DD` | ວັນເຂົ້າ-ອອກ ທີ່ **ສົ່ງໄປ** | `"checkIn": "2026-09-09"` |
| ISO 8601 UTC | ເວລາທີ່ **ໄດ້ຮັບກັບມາ** | `"createdAt": "2026-08-08T09:11:06.962Z"` |

`checkIn`/`checkOut` ທີ່ໄດ້ຮັບກັບມາຈາກ booking ເປັນ ISO ເຕັມ (`"2026-09-22T00:00:00.000Z"`)
ແຕ່ **ເປັນວັນທີ່ ບໍ່ແມ່ນເວລາ** — ຕັດ 10 ຕົວທຳອິດເອົາ ຢ່າແປງເປັນເວລາທ້ອງຖິ່ນ ບໍ່ດັ່ງນັ້ນ
ຢູ່ເຂດເວລາລາວ (UTC+7) ມັນຈະກາຍເປັນວັນກ່ອນໜ້າ.

`rules.checkInFrom` ເປັນ `"1970-01-01T14:00:00.000Z"` — **ເອົາແຕ່ເວລາ** ວັນທີ່ 1970 ບໍ່ມີຄວາມໝາຍ.

**4 · Token ຢູ່ໄດ້ 15 ນາທີ**
ຕ້ອງເຮັດ auto-refresh. ອ່ານຂໍ້ 2.

**5 · ຂໍ້ຄວາມ error ເປັນສອງພາສາ ສະແດງໄດ້ເລີຍ**
`"ບໍ່ພົບທີ່ພັກ #999999 · Property not found"` — ຝັ່ງລາວກ່ອນ `·` ເອົາໄປສະແດງໃຫ້ຜູ້ໃຊ້ໄດ້ໂດຍກົງ.

**6 · ຫ້ອງຖືກກັນໄວ້ 15 ນາທີເທົ່ານັ້ນ**
ຈອງແລ້ວບໍ່ຈ່າຍພາຍໃນ `holdExpiresAt` ຫ້ອງຖືກປ່ອຍຄືນອັດຕະໂນມັດ. ອ່ານຂໍ້ 5.

---

## 2 · Auth

### ສະໝັກ

```http
POST /auth/register
Content-Type: application/json

{ "email": "…", "password": "…", "fullName": "…", "phone": "+856 20 …" }
```

`password` ຢ່າງໜ້ອຍ 8 ຕົວ · `fullName` ຢ່າງໜ້ອຍ 2 ຕົວ · `phone` ຢ່າງໜ້ອຍ 6 ຕົວ.
ຕອບກັບຄືກັນກັບ login ລຸ່ມນີ້.

### ເຂົ້າສູ່ລະບົບ

```http
POST /auth/login
{ "email": "souda.v@gmail.com", "password": "Customer@2026" }
```

```json
{
  "accessToken": "eyJhbGciOi…",
  "refreshToken": "eyJhbGciOi…",
  "expiresIn": "15m",
  "user": {
    "id": "9",
    "email": "souda.v@gmail.com",
    "role": "CUSTOMER",
    "adminRole": null,
    "fullName": "ນາງ ສຸດາ ວົງສາ",
    "phone": "+856 20 5789 1234",
    "isVerified": true,
    "partnerId": null,
    "partnerStatus": null
  }
}
```

> **ຕ້ອງກວດ `role`.** ບັນຊີດຽວກັນໃຊ້ໄດ້ທັງສາມແອັບ — ເຈົ້າຂອງທີ່ພັກ login ໃສ່ແອັບລູກຄ້າ
> ຈະໄດ້ token ຈິງ ແຕ່ບໍ່ມີສິດເຂົ້າ `/customer/*` ເລີຍ. ຖ້າ `role != "CUSTOMER"` ໃຫ້ປະຕິເສດ
> ຢູ່ໜ້າ login ພ້ອມບອກວ່າໃຫ້ໄປໃຊ້ແອັບ LaoStay Partner.

### ຕໍ່ອາຍຸ token

```http
POST /auth/refresh
{ "refreshToken": "…" }
```

ຕອບກັບຄືກັນກັບ login. **refresh token ຖືກປ່ຽນໃໝ່ທຸກເທື່ອ** — ອັນເກົ່າໃຊ້ບໍ່ໄດ້ອີກ.

> **ຈຸດທີ່ຜິດພາດງ່າຍທີ່ສຸດ.** ຖ້າມີ 3 ຄຳຂໍໄດ້ 401 ພ້ອມກັນ ແລ້ວແຕ່ລະອັນເອີ້ນ refresh
> ຂອງຕົນເອງ ຈະມີພຽງອັນດຽວສຳເລັດ ອີກສອງອັນຖືກປະຕິເສດ ແລະ ຜູ້ໃຊ້ຖືກເຕະອອກ.
> **ຕ້ອງມີ single-flight** — refresh ໄດ້ເທື່ອລະອັນ ອັນອື່ນລໍຜົນຂອງອັນນັ້ນ.
> ເບິ່ງຕົວຢ່າງທີ່ເຮັດແລ້ວຢູ່ [webapp/src/lib/api.ts](../webapp/src/lib/api.ts).

### ອື່ນໆ

| | |
|---|---|
| `GET /auth/me` | ໂປຣໄຟລ໌ຈາກ token — ໃຊ້ກວດຕອນເປີດແອັບວ່າ token ຍັງໃຊ້ໄດ້ |
| `POST /auth/logout` | `{ "refreshToken": "…" }` |
| `PATCH /auth/password` | `{ "currentPassword": "…", "newPassword": "…" }` |
| `POST /auth/password/forgot` | `{ "email": "…" }` |
| `POST /auth/password/reset` | `{ "token": "…", "password": "…" }` |
| `POST /auth/otp/request` | `{ "target": "+856…", "purpose": "phone_verify" }` |
| `POST /auth/otp/verify` | `{ "target": "…", "purpose": "…", "code": "1234" }` |

> ⚠️ **OTP ແລະ ກູ້ລະຫັດຜ່ານຍັງສົ່ງບໍ່ໄດ້ຈິງ.** Server ສ້າງລະຫັດ ເກັບໄວ້ ແລະ ຕອບ
> `{ "sent": true }` ແຕ່ **ບໍ່ມີໃຜສົ່ງ SMS ຫຼື ອີເມວ** — ຍັງບໍ່ໄດ້ເລືອກຜູ້ໃຫ້ບໍລິການ.
> ນອກ production response ຈະມີ `devCode` / `devToken` ຕິດມາເພື່ອໃຫ້ທົດສອບໄດ້.
> **ຢ່າສ້າງໜ້າຢືນຢັນເບີໂທເປັນທາງບັງຄັບ** ຈົນກວ່າສ່ວນນີ້ພ້ອມ.

---

## 3 · ຄົ້ນຫາ ແລະ ເບິ່ງທີ່ພັກ

ທັງໝົດເປັນ **public** — ບໍ່ຕ້ອງ login. ໃຫ້ຜູ້ໃຊ້ເບິ່ງກ່ອນສະໝັກໄດ້.

### `GET /properties`

| param | ຄ່າ |
|---|---|
| `q` | ຄົ້ນຫາຕົວອັກສອນ (full-text) |
| `provinceId` · `districtId` | int |
| `type` | `homestay` `villa` `resort` `guesthouse` — ໝົດເທົ່ານີ້ |
| `checkIn` · `checkOut` | `YYYY-MM-DD` — **ໃສ່ຄູ່ ຫຼື ບໍ່ໃສ່ເລີຍ** |
| `guests` | 1–30 |
| `minPrice` · `maxPrice` | ກີບ |
| `lat` · `lng` · `radiusKm` | ໃສ່ lat+lng ຈຶ່ງໄດ້ `distanceKm` ກັບມາ, radius 1–500 |
| `sort` | `rating` `price_asc` `price_desc` `reviews` `distance` |
| `page` · `limit` | limit ສູງສຸດ 50, ຄ່າເລີ່ມຕົ້ນ 20 |

```json
{
  "items": [{
    "id": "2",
    "name": "Hom Sabay Guesthouse",
    "type": "guesthouse",
    "province": "ຫຼວງພະບາງ",
    "district": "ຫຼວງພະບາງ",
    "address": "ບ້ານຊຽງທອງ ເມືອງຫຼວງພະບາງ",
    "lat": 19.8834, "lng": 102.1347,
    "rating": 4.8, "reviewCount": 4,
    "coverImage": null,
    "fromPricePerNight": 320000,
    "staySubtotal": 1008000,
    "nights": 3,
    "availableRoomTypes": 4,
    "distanceKm": null
  }],
  "total": 5, "page": 1, "limit": 2, "pages": 3
}
```

**ໃສ່ວັນທີ່ແລ້ວຕ່າງກັນແນວໃດ** — ໃສ່ `checkIn`/`checkOut` ຜົນລັບຈະຖືກກັ່ນຕອງດ້ວຍ
**ຫ້ອງວ່າງຈິງ** ແລະ ໄດ້ `staySubtotal` (ລາຄາລວມທັງການເຂົ້າພັກ) ກັບ `nights` ມາ.
ບໍ່ໃສ່ → ໄດ້ທຸກທີ່ພັກ ແລະ `staySubtotal` ເປັນ null, ສະແດງ `fromPricePerNight` ແທນ.

### `GET /properties/:id?checkIn=&checkOut=`

```json
{
  "id": "2", "name": "Hom Sabay Guesthouse", "type": "guesthouse",
  "description": "…", "phone": null,
  "province": "ຫຼວງພະບາງ", "district": "ຫຼວງພະບາງ", "village": null,
  "address": "…", "lat": 19.8834, "lng": 102.1347,
  "rating": 4.8, "reviewCount": 4,
  "images": [],
  "amenities": [ … 6 ອັນ … ],
  "rules": {
    "checkInFrom": "1970-01-01T14:00:00.000Z",
    "checkOutUntil": "1970-01-01T12:00:00.000Z",
    "smokingAllowed": false, "petAllowed": true,
    "childAllowed": true, "partyAllowed": false,
    "quietHoursStart": "1970-01-01T22:00:00.000Z",
    "quietHoursEnd": "1970-01-01T07:00:00.000Z",
    "note": null
  },
  "cancellationPolicy": {
    "name": "ປານກາງ · Moderate",
    "daysBeforeCheckin": 5,
    "penaltyPercent": 30,
    "isRefundable": true,
    "description": "ຍົກເລີກກ່ອນເຂົ້າພັກ 5 ວັນ ຄືນເງິນເຕັມ · ຫຼັງຈາກນັ້ນຫັກ 30%"
  },
  "host": { "id": "2", "name": "Hom Sabay Guesthouse" },
  "nights": 3,
  "roomTypes": [{
    "id": "5", "name": "Standard Fan", "description": "…",
    "bedType": "single", "hasAc": false,
    "maxOccupancy": 2, "extraGuestFee": 50000, "sizeSqm": null,
    "basePrice": 320000, "totalRooms": 6, "minNights": 1,
    "images": [],
    "stayTotal": 1008000,
    "available": true
  }],
  "reviews": [{
    "id": "1", "stars": 5, "title": "ຄຸ້ມຄ່າຫຼາຍ",
    "comment": "…", "guest": "ນາງ ມະລິ ໄຊຍະ",
    "createdAt": "2026-08-08T07:36:10.240Z"
  }]
}
```

ຫ້ອງທີ່ຈອງໄດ້ຄື `available: true`. `stayTotal` ມີກໍຕໍ່ເມື່ອສົ່ງວັນທີ່ມາ.

**ຢາກເຫັນຄຳຕອບຂອງເຈົ້າຂອງທີ່ພັກຕໍ່ຮີວິວ** ໃຫ້ເອີ້ນ `GET /reviews/:id` ແຍກ (ຂໍ້ 8) —
ຮີວິວສ່ວນຫຼາຍບໍ່ມີຄຳຕອບ ຈຶ່ງບໍ່ໃສ່ມາທຸກອັນໃຫ້ເສຍເນັດ.

### `GET /properties/:id/calendar?from=&to=`

```json
{
  "propertyId": "2",
  "roomTypes": [{
    "id": "5", "name": "Standard Fan", "totalRooms": 6,
    "days": [
      { "date": "2026-09-09", "price": 320000, "available": 6, "open": true },
      { "date": "2026-09-11", "price": 368000, "available": 6, "open": true }
    ]
  }]
}
```

ລາຄາຕ່າງກັນຕາມວັນໄດ້ (ຕົວຢ່າງເທິງ: ວັນສຸກແພງກວ່າ). ໃຊ້ວາດປະຕິທິນເລືອກວັນ.

### ອື່ນໆ

`GET /locations/provinces` · `GET /locations/districts?provinceId=` · `GET /amenities`

---

## 4 · ຈອງ

### ຂັ້ນຕອນທັງໝົດ

```
1. quote     → ບອກລາຄາ, ບໍ່ຂຽນຫຍັງ
2. create    → ສ້າງການຈອງ status=pending, ກັນຫ້ອງ 15 ນາທີ
3. pay       → ໄດ້ QR
4. poll      → ລໍຈົນ status=paid
5. ສຳເລັດ    → booking ກາຍເປັນ confirmed
```

### 1 · ບອກລາຄາກ່ອນ

```http
POST /customer/bookings/quote
{ "roomTypeId": "5", "checkIn": "2026-09-09", "checkOut": "2026-09-12", "guests": 2 }
```

```json
{
  "roomTypeId": "5", "propertyId": "2", "nights": 3, "quantity": 1,
  "perNight": [
    { "date": "2026-09-09", "price": 320000 },
    { "date": "2026-09-10", "price": 320000 },
    { "date": "2026-09-11", "price": 368000 }
  ],
  "subtotal": 1008000,
  "serviceFee": 50400,
  "tax": 0,
  "cleaningFee": 0,
  "discount": 0,
  "total": 1058400
}
```

`subtotal + serviceFee + tax + cleaningFee − discount = total` ສະເໝີ.
ຢ່າຄິດເລກເອງໃນແອັບ — ໃຊ້ `total` ຈາກ server.

### 2 · ສ້າງການຈອງ

```http
POST /customer/bookings
{
  "roomTypeId": "5",
  "checkIn": "2026-09-09",
  "checkOut": "2026-09-12",
  "guests": 2,
  "quantity": 1,
  "specialRequest": "ຂໍຫ້ອງຊັ້ນລຸ່ມ",
  "idempotencyKey": "<uuid ຈາກແອັບ>"
}
```

> **`idempotencyKey` ຕ້ອງໃສ່.** ສ້າງ UUID ເທື່ອດຽວຕອນຜູ້ໃຊ້ກົດປຸ່ມ ແລ້ວໃຊ້ອັນເກົ່າ
> ຖ້າຕ້ອງລອງໃໝ່. ເນັດມືຖືລາວຫຼຸດການເຊື່ອມຕໍ່ເລື້ອຍ — ຖ້າບໍ່ມີ key ນີ້ ຜູ້ໃຊ້ຈະໄດ້
> ການຈອງສອງອັນ ແລະ ຈ່າຍສອງເທື່ອ.

**409 ຄືຄຳຕອບ ບໍ່ແມ່ນ bug** — ຫ້ອງອາດຖືກຄົນອື່ນຈອງໄປລະຫວ່າງທີ່ຜູ້ໃຊ້ຕັດສິນໃຈ:

```json
{
  "statusCode": 409,
  "error": "ConflictException",
  "message": "ບາງຄືນຍັງບໍ່ໄດ້ເປີດຂາຍ · Some nights in that range are not on sale"
}
```

ສະແດງ `message` ໃຫ້ຜູ້ໃຊ້ ແລ້ວພາກັບໄປໜ້າເລືອກວັນ.

### 3 · ຈ່າຍ

```http
POST /customer/bookings/:id/pay
```

```http
GET /customer/payments/:id
```

```json
{
  "id": "54",
  "bookingId": "121",
  "method": "phajay_qr",
  "qrPayload": "00020101021230210013la.phajay.sim01005…",
  "amount": 672000,
  "status": "paid",
  "paidAt": "2026-08-08T08:18:25.163Z",
  "expiresAt": "2026-08-08T08:33:19.189Z",
  "txnRef": "SIM-3065C288EC98A808",
  "bookingStatus": "confirmed"
}
```

`qrPayload` ເປັນ string ມາດຕະຖານ **EMVCo** — ເອົາເຂົ້າ package ວາດ QR ໃດກໍໄດ້
(`qr_flutter`) ໂດຍບໍ່ຕ້ອງແປງ. ຜູ້ໃຊ້ສະແກນດ້ວຍແອັບທະນາຄານ **ແລ້ວຈ່າຍໄດ້ເລີຍ** —
ບໍ່ຕ້ອງເລືອກທະນາຄານ ບໍ່ຕ້ອງເປີດໜ້າໃດ.

**`POST /customer/bookings/:id/pay` ຄືນ `deepLink` ມານຳ** (ອາດເປັນ `null`):

```json
{ "id": "54", "qrPayload": "000201...", "deepLink": "onepay://qr/000201...", ... }
```

ຢູ່ມືຖື ຜູ້ໃຊ້ສະແກນຈໍຂອງຕົນເອງບໍ່ໄດ້ — ໃຫ້ມີປຸ່ມ **"ເປີດແອັບທະນາຄານ"** ທີ່ເປີດ
`deepLink` ຢູ່ຂ້າງ QR. ຢູ່ຄອມສະແດງແຕ່ QR ພໍ.

`deepLink` ມີສະເພາະຕອນສ້າງ QR ເທື່ອທຳອິດ — `GET /customer/payments/:id` ບໍ່ຄືນມັນ
ຈຶ່ງເກັບໄວ້ຕັ້ງແຕ່ຕອນນັ້ນ.

**ຕ້ອງ poll** `GET /customer/payments/:id` ທຸກ 3–5 ວິນາທີ ຈົນ `status == "paid"`.
ບໍ່ມີ push ບອກ. ພໍ paid ແລ້ວ `bookingStatus` ຈະເປັນ `confirmed`.

ຢູ່ເຄື່ອງພັດທະນາ ຈຳລອງການຈ່າຍໄດ້ດ້ວຍ `POST /payments/dev/settle/:paymentId` (ບໍ່ຕ້ອງ token).

### 4 · ນັບຖອຍຫຼັງ

`holdExpiresAt` ຢູ່ໃນ booking ບອກເວລາທີ່ຫ້ອງຈະຖືກປ່ອຍຄືນ. ຕ້ອງສະແດງໃຫ້ຜູ້ໃຊ້ເຫັນ
ຢູ່ໜ້າຈ່າຍ. ໝົດເວລາແລ້ວ server ຍົກເລີກໃຫ້ເອງ (cron ແລ່ນທຸກນາທີ) ແລະ status ຈະກາຍເປັນ
`cancelled` — ແອັບບໍ່ຕ້ອງເຮັດຫຍັງ ນອກຈາກບອກຜູ້ໃຊ້.

---

## 5 · ການເດີນທາງຂອງຂ້ອຍ

### `GET /customer/bookings?page=&limit=`

```json
{
  "items": [{
    "id": "121", "code": "STL-0079",
    "propertyId": "2", "property": "Hom Sabay Guesthouse",
    "province": "ຫຼວງພະບາງ", "photo": null,
    "roomType": "Standard Fan",
    "checkIn": "2026-09-22T00:00:00.000Z",
    "checkOut": "2026-09-24T00:00:00.000Z",
    "nights": 2, "guests": 1, "total": 672000,
    "status": "cancelled",
    "holdExpiresAt": null,
    "paymentId": "54",
    "paymentStatus": "partially_refunded",
    "reviewed": false
  }],
  "total": 6, "page": 1, "limit": 2, "pages": 3
}
```

### `GET /customer/bookings/:id`

ໃຫຍ່ກວ່າ — ມີເພີ່ມ:

```json
{
  "subtotal": 672000, "discount": 0, "tax": 0,
  "serviceFee": 0, "cleaningFee": 0, "total": 672000,
  "paidAmount": 672000,
  "property": { "id":"2", "name":"…", "province":"…", "district":"…",
                "address":"…", "phone": null, "host": "…" },
  "roomType": { "id":"5", "name":"Standard Fan", "quantity":1, "pricePerNight":320000 },
  "guests": [ { "name":"ນາງ ສຸດາ ວົງສາ", "type":"adult", "isPrimary":true } ],
  "payments": [ { "id":"54", "status":"partially_refunded", "amount":672000,
                  "paidAt":"…", "expiresAt":"…" } ],
  "refunds":  [ { "id":"13", "amount":470400, "status":"completed",
                  "reason":"ປ່ຽນແຜນ", "refundedAt":"…" } ],
  "cancellation": { "reason":"ປ່ຽນແຜນ", "penalty":201600,
                    "refund":470400, "cancelledAt":"…" },
  "cancellationPolicy": { … },
  "review": null,
  "holdExpiresAt": null,
  "specialRequest": null
}
```

> **ໃຊ້ `paidAmount` ຢ່າຄິດເອງຈາກ `payments[]`.** ຫຼັງຄືນເງິນບາງສ່ວນ payment status
> ກາຍເປັນ `partially_refunded` — ຖ້າແອັບບວກສະເພາະອັນທີ່ `status == "paid"` ຈະໄດ້ 0
> ແລ້ວສະແດງວ່າ "ຍັງບໍ່ຈ່າຍ" ທັງທີ່ຈ່າຍໄປແລ້ວ. **ອັນນີ້ເປັນບັກຈິງທີ່ເຄີຍເກີດຢູ່ເວັບ.**

### ຍົກເລີກ

```http
POST /customer/bookings/:id/cancel
{ "reason": "ປ່ຽນແຜນ" }
```

ຕອບກັບພ້ອມ `penalty` ແລະ `refund` ທີ່ຄິດຈາກ `cancellationPolicy` ຂອງທີ່ພັກ.
`penalty + refund = ຈຳນວນທີ່ຈ່າຍມາ` ສະເໝີ — ສະແດງທັງສາມຕົວເລກ.

### ຮີວິວ

```http
POST /customer/bookings/:id/review
{ "stars": 5, "cleanliness": 5, "service": 5, "value": 4,
  "title": "…", "comment": "…" }
```

`stars` 1–5 ບັງຄັບ. ຄະແນນຍ່ອຍ `cleanliness` · `service` · `value` (1–5) ແລະ
`title` (≤255) · `comment` (≤2000) ບໍ່ບັງຄັບ.
ຮີວິວໄດ້ຫຼັງເຂົ້າພັກແລ້ວເທົ່ານັ້ນ — ໃຊ້ `reviewed` ໃນລາຍການເພື່ອເຊື່ອງປຸ່ມ.

---

## 6 · ໂປຣໄຟລ໌ · ທີ່ມັກ · ແຈ້ງເຕືອນ

| | |
|---|---|
| `GET /customer/me` | ໂປຣໄຟລ໌ |
| `PATCH /customer/me` | `{ "fullName": "…", "phone": "…" }` |
| `GET /customer/wishlist` | ລາຍການທີ່ມັກ |
| `POST /customer/wishlist/:propertyId` | ເພີ່ມ |
| `POST /customer/wishlist/:propertyId/remove` | ເອົາອອກ (**POST ບໍ່ແມ່ນ DELETE**) |
| `GET /customer/notifications` | `{ items: [...], unread: 3 }` |
| `POST /customer/notifications/read-all` | ອ່ານໝົດ |
| `POST /customer/notifications/:id/read` | ອ່ານອັນດຽວ |

```json
{
  "id": "108",
  "title": "ມີຂໍ້ຄວາມໃໝ່",
  "message": "ວັນນະສອນ ພິມມະສອນ: ມີເດີ ຈອດໄດ້ 3 ຄັນ",
  "type": "system",
  "referenceType": "conversation",
  "referenceId": "8",
  "isRead": false,
  "createdAt": "2026-08-08T09:11:17.227Z"
}
```

`referenceType` + `referenceId` ບອກວ່າກົດແລ້ວຄວນພາໄປໃສ — `booking` → ໜ້າການຈອງ,
`conversation` → ໜ້າແຊັດ, `review` → ໜ້າຮີວິວ.

---

## 7 · ແຊັດກັບເຈົ້າຂອງທີ່ພັກ

| | |
|---|---|
| `GET /customer/conversations` | `{ items: [...], unreadTotal: 2 }` |
| `GET /customer/conversations/unread` | `{ total: 2 }` — ສຳລັບ badge |
| `POST /customer/conversations` | `{ "propertyId": "1", "bookingId": "121" }` |
| `GET /customer/conversations/:id/messages?since=&limit=` | |
| `POST /customer/conversations/:id/messages` | `{ "text": "…", "replyToId": "…" }` |
| `POST /customer/conversations/:id/read` | |
| `DELETE /customer/conversations/:id/messages/:messageId` | ລຶບຂໍ້ຄວາມຂອງຕົນ |

```json
{
  "id": "8", "propertyId": "1", "property": "Vintage House Vientiane",
  "counterpartName": "Vintage House Vientiane",
  "bookingId": null, "bookingCode": null,
  "status": "open",
  "lastMessage": "ມີເດີ ຈອດໄດ້ 3 ຄັນ",
  "lastMessageAt": "2026-08-08T09:11:15.722Z",
  "lastMessageMine": false,
  "unread": 0
}
```

```json
{
  "id": "48", "conversationId": "8",
  "senderId": "9", "senderName": "ນາງ ສຸດາ ວົງສາ",
  "mine": true,
  "type": "text",
  "text": "ມີບ່ອນຈອດລົດບໍ?",
  "isDeleted": false, "isEdited": false,
  "replyToId": null,
  "createdAt": "2026-08-08T09:11:06.962Z"
}
```

**ບໍ່ຕ້ອງຈອງກ່ອນຈຶ່ງທັກໄດ້** — `bookingId` ບໍ່ບັງຄັບ. ຖາມກ່ອນຈອງຄືຈຸດປະສົງ.
ເອີ້ນ `POST /customer/conversations` ຊ້ຳໄດ້ — ຖ້າມີຫ້ອງສົນທະນາເປີດຢູ່ແລ້ວມັນຄືນອັນເກົ່າ
ບໍ່ສ້າງອັນທີສອງ.

**ດຶງຂໍ້ຄວາມໃໝ່ດ້ວຍ `since=<id ຂອງຂໍ້ຄວາມສຸດທ້າຍ>`** ບໍ່ແມ່ນ timestamp.
ສອງຂໍ້ຄວາມທີ່ຂຽນໃນມິນລິວິນາທີດຽວກັນຈະເຮັດໃຫ້ cursor ແບບເວລາຂ້າມ ຫຼື ຊ້ຳ.
Poll ທຸກ 5 ວິນາທີພໍ. ຍັງບໍ່ມີ WebSocket ແລະ ຍັງບໍ່ມີ push.

`mine` ບອກວ່າຂໍ້ຄວາມນີ້ຂອງເຮົາເອງບໍ — ໃຊ້ຈັດຊ້າຍ/ຂວາ ບໍ່ຕ້ອງທຽບ `senderId` ເອງ.

**ໄຟລ໌ແນບຍັງບໍ່ມີ.** ຕາຕະລາງມີແຕ່ບໍ່ມີ endpoint.

---

## 8 · ຮີວິວ ແລະ ຄຳຕອບ

```http
GET /reviews/:id          (public)
```

```json
{
  "id": "1", "propertyId": "2", "property": "Hom Sabay Guesthouse",
  "stars": 5, "title": "ຄຸ້ມຄ່າຫຼາຍ", "comment": "…",
  "guest": "ນາງ ມະລິ ໄຊຍະ",
  "status": "published",
  "createdAt": "2026-08-08T07:36:10.240Z",
  "images": [],
  "replies": [{
    "id": "7", "text": "ຂອບໃຈຫຼາຍເດີ",
    "author": "ວັນນະສອນ ພິມມະສອນ", "authorId": "3",
    "createdAt": "…",
    "children": []
  }]
}
```

`replies` ເປັນຕົ້ນໄມ້ — `children` ຊ້ອນເລິກເທົ່າໃດກໍໄດ້. ຢູ່ມືຖືແນະນຳໃຫ້ຢຽບແປ
ຫຼັງຊັ້ນທີສອງ.

| | |
|---|---|
| `POST /reviews/:id/replies` | `{ "text": "…", "parentReplyId": "…" }` — ໄດ້ສະເພາະຄົນຂຽນຮີວິວ ຫຼື ເຈົ້າຂອງທີ່ພັກ |
| `DELETE /reviews/:id/replies/:replyId` | ລຶບຂອງຕົນ |
| `POST /customer/reviews/:id/images` | `{ "url": "…" }` ສູງສຸດ 6 ຮູບ |

> POST reply ຄືນ **ຕົ້ນໄມ້ທັງໝົດ** ບວກ `replyId` ຂອງແຖວທີ່ຫາກໍຂຽນ.
> ໃຊ້ `replyId` ຢ່າເອົາອັນສຸດທ້າຍໃນ `replies` — ຄຳຕອບຊ້ອນເປັນລູກ ບໍ່ແມ່ນອັນສຸດທ້າຍ.

---

## 9 · ເນື້ອຫາໜ້າຫຼັກ

ທັງໝົດ public.

| | |
|---|---|
| `GET /content/home` | `{ banners: [...], announcements: [...] }` |
| `GET /content/faqs` | ຈັດກຸ່ມແລ້ວ `[{ category, items: [{id, question, answer}] }]` |
| `GET /content/pages` | slug ທີ່ເຜີຍແຜ່ແລ້ວ |
| `GET /content/pages/:slug` | `terms` · `privacy` · `partner_agreement` · `about` |

Server ກັ່ນຕອງ **ວັນທີ່** ໃຫ້ແລ້ວ — banner ທີ່ໝົດອາຍຸຈະບໍ່ຖືກສົ່ງມາ ແອັບບໍ່ຕ້ອງກວດ.

`banners[].targetType` ເປັນ `property` `promotion` ຫຼື `url`. **ຮອງຮັບແຕ່ `property`**
(ໄປໜ້າ `targetId`) — ອີກສອງອັນຍັງໃຊ້ບໍ່ໄດ້, ໃຫ້ສະແດງເປັນຮູບເສີຍໆ ບໍ່ຕ້ອງກົດໄດ້.

`content` ເປັນ **ຂໍ້ຄວາມທຳມະດາ ບໍ່ແມ່ນ HTML** — ໃຫ້ສະແດງດ້ວຍ `pre-wrap` ຫຼື ທຽບເທົ່າ.
ຢ່າ render ເປັນ HTML: ເນື້ອຫາມາຈາກ CMS ແລະ ບໍ່ໄດ້ຖືກ sanitize.

ໜ້າ `terms` `privacy` `partner_agreement` **ເຜີຍແຜ່ແລ້ວ**. ເຖິງຢ່າງນັ້ນ ໃນ
ຖານຂໍ້ມູນໃໝ່ (`db:reset`) ມັນຈະກັບເປັນຮ່າງອີກ ແລະ ຈະໄດ້ 404 ຈົນກວ່າຈະແລ່ນ
`backend/scripts/seed-pages.mjs`. ສະນັ້ນສຳລັບລິ້ງໃນ footer ຫຼື ເມນູ ໃຫ້ອ່ານຈາກ
`GET /content/pages` ແລ້ວສະແດງສະເພາະທີ່ມີ.

---

## 10 · Error

ທຸກ error ໜ້າຕາຄືກັນ:

```json
{
  "statusCode": 404,
  "error": "NotFoundException",
  "message": "ບໍ່ພົບທີ່ພັກ #999999 · Property not found",
  "path": "/api/properties/999999",
  "timestamp": "2026-08-10T05:35:02.325Z"
}
```

**ຍົກເວັ້ນ validation — `message` ກາຍເປັນ array:**

```json
{
  "statusCode": 400,
  "message": ["ອີເມວບໍ່ຖືກຕ້ອງ · Invalid email",
              "ລະຫັດຜ່ານຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ · Minimum 8 characters"]
}
```

ໃນ Dart ຕ້ອງຮັບໄດ້ທັງສອງແບບ:

```dart
final raw = body['message'];
final text = raw is List ? raw.join('\n') : raw.toString();
```

| code | ຄວາມໝາຍ | ແອັບຄວນເຮັດຫຍັງ |
|---|---|---|
| 400 | ຂໍ້ມູນບໍ່ຖືກ | ສະແດງ message |
| 401 | token ໝົດອາຍຸ/ບໍ່ມີ | refresh ແລ້ວລອງໃໝ່ 1 ເທື່ອ, ລົ້ມແລ້ວພາໄປ login |
| 403 | ບໍ່ມີສິດ | ສະແດງ message |
| 404 | ບໍ່ພົບ | ສະແດງ message |
| **409** | **ຫ້ອງບໍ່ວ່າງ / ຈອງຊ້ອນ** | **ສະແດງ message ແລ້ວພາກັບໄປເລືອກວັນ** |
| 429 | ຂໍຖີ່ເກີນ | ລໍແລ້ວລອງໃໝ່ |
| 503 | DB ຫຍຸ້ງ | ລອງໃໝ່ໄດ້ |

**409 ຢ່າ retry ອັດຕະໂນມັດ** — ຫ້ອງບໍ່ວ່າງ ຈຶ່ງລອງອີກກີ່ເທື່ອກໍບໍ່ວ່າງ.

---

## 11 · ຄວາມໄວ

ຢູ່ການຕັ້ງຄ່າປັດຈຸບັນ (API ຢູ່ລາວ, DB ຢູ່ `us-east-1`) ຄຳຂໍທີ່ຕ້ອງ login
ໃຊ້ເວລາ **1.5–5 ວິນາທີ**. ຫຼັງຍ້າຍທັງສອງໄປພາກພື້ນດຽວກັນຈະເຫຼືອຫຼັກສິບມິນລິວິນາທີ.

ລະຫວ່າງນີ້ **ຢ່າໃສ່ timeout 3 ວິນາທີ** — ໃຊ້ 30 ວິນາທີ, ແລະ ສະແດງ skeleton
ບໍ່ແມ່ນໜ້າວ່າງເປົ່າ.

---

## 12 · ບັນຊີສຳລັບທົດສອບ

| | |
|---|---|
| ລູກຄ້າ | `souda.v@gmail.com` / `Customer@2026` |
| ຈຳລອງການຈ່າຍ | `POST /payments/dev/settle/:paymentId` (ບໍ່ຕ້ອງ token) |

ຂໍ້ມູນທົດສອບມີ 5 ທີ່ພັກ, ຫຼາຍປະເພດຫ້ອງ, ຮີວິວ ແລະ ການຈອງເກົ່າຢູ່ແລ້ວ.

---

## 13 · ຍັງບໍ່ມີ — ຢ່າອອກແບບພຶ່ງພາ

| | ສະຖານະ |
|---|---|
| Push notification | ບໍ່ມີ. ຕ້ອງ poll ເອົາ |
| ສົ່ງ SMS / OTP ຈິງ | ບໍ່ມີ — ຢ່າບັງຄັບຢືນຢັນເບີໂທ |
| ສົ່ງອີເມວ (ກູ້ລະຫັດຜ່ານ) | ບໍ່ມີ |
| WebSocket ສຳລັບແຊັດ | ບໍ່ມີ — poll 5 ວິນາທີ |
| ໄຟລ໌ແນບໃນແຊັດ | ບໍ່ມີ |
| ໂຄ້ດສ່ວນຫຼຸດ | ບໍ່ມີ — `discount` ຄືນ 0 ສະເໝີ |
| ຮູບຫຼາຍຂະໜາດ | ບໍ່ມີ — ໄດ້ 1600px ອັນດຽວ, ~250KB ຕໍ່ຮູບ |

ຮູບຂະໜາດດຽວແປວ່າໜ້າຄົ້ນຫາທີ່ສະແດງ 20 ທີ່ພັກຈະໂຫຼດປະມານ 5MB.
ຖ້າເປັນໄປໄດ້ໃຫ້ໂຫຼດແບບ lazy ແລະ cache ໄວ້.

---

*ສ້າງຈາກ response ຈິງຂອງ server. ຢາກສ້າງໃໝ່: `node scripts/capture-api.mjs` ໃນ `backend/`.*

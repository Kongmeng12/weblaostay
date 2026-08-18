# Deploy — phaphak.com

ເຄື່ອງນີ້ **ຄື** server. Cloudflare Tunnel ດຶງ `localhost:3100` ອອກໄປເປັນ
`phaphak.com` ໂດຍບໍ່ຕ້ອງເປີດ port ໃດເລີຍໃນ router.

```
phaphak.com        ─┐
www.phaphak.com    ─┼─ Cloudflare Tunnel ─→ localhost:3100 (NestJS)
admin.phaphak.com  ─┘                          ├─ /api/*      API
                                               ├─ /uploads/*  ຮູບ (disk)
                                               └─ /*          webapp / webadmin
```

## ເປັນຫຍັງທຸກຢ່າງຢູ່ process ດຽວ

ບໍ່ແມ່ນເພື່ອຄວາມງ່າຍ — ແມ່ນຂໍ້ບັງຄັບ. ເວັບທັງສອງເອີ້ນ API ດ້ວຍ path ແບບ relative
(`const BASE = '/api'`) ແລະ `local-disk.storage.ts` ຂຽນ URL ຮູບລົງ database ເປັນ
`/uploads/<key>` ຊຶ່ງກໍ່ relative ຄືກັນ. ຖ້າແຍກເວັບໄປ host ອື່ນ ຕ້ອງໄປໄລ່ແກ້ URL ຮູບ
ທຸກແຖວໃນ database. ຢູ່ origin ດຽວແລ້ວບໍ່ຕ້ອງແກ້ຫຍັງເລີຍ — ແລະ ບໍ່ມີ CORS ນຳ.

`admin.phaphak.com` ກັບ `phaphak.com` ຊີ້ມາບ່ອນດຽວກັນ; ຝັ່ງ backend ເລືອກເອົາເວັບໃດ
ຈາກ Host header ຕາມ `ADMIN_HOST` ໃນ `backend/.env`.

## ຕັ້ງຄັ້ງທຳອິດ

```powershell
cloudflared tunnel login          # ເປີດ browser → ເລືອກ phaphak.com
.\deploy\tunnel-setup.ps1         # ສ້າງ tunnel + config.yml + DNS 3 record
.\deploy\build.ps1                # build backend + webapp + webadmin
.\deploy\start.ps1                # ເປີດ API ແລ້ວຄ່ອຍເປີດ tunnel
```

ແລ້ວໄປລົງທະບຽນ webhook ໃນ portal ຂອງ PhaJay:

```
https://phaphak.com/api/payments/phajay/webhook/<PHAJAY_WEBHOOK_SECRET>
```

ຄ່າ secret ຢູ່ໃນ `backend/.env`. ອັນນີ້ **ຕ້ອງກົດເອງ** — ບໍ່ມີ API ໃຫ້ຕັ້ງແທນ.

ຢາກໃຫ້ຄືນມາເອງຫຼັງ restart ເຄື່ອງ:

```powershell
.\deploy\install-autostart.ps1
```

## ໃຊ້ປະຈຳວັນ

| ຢາກເຮັດຫຍັງ | ຄຳສັ່ງ |
|---|---|
| ແກ້ເວັບ (React) | `.\deploy\build.ps1` — **ຂຶ້ນທັນທີ ບໍ່ຕ້ອງ restart** |
| ແກ້ backend (`.ts`) | `.\deploy\build.ps1` ແລ້ວ `.\deploy\stop.ps1; .\deploy\start.ps1` |
| ແກ້ `.env` | `.\deploy\stop.ps1; .\deploy\start.ps1` (ບໍ່ຕ້ອງ build) |
| ເບິ່ງ log | `Get-Content .\deploy\logs\api.log -Tail 50 -Wait` |
| ເຊັກວ່າຍັງດີຢູ່ | `curl https://phaphak.com/api/health` |
| ປິດ | `.\deploy\stop.ps1` |
| Backup ດຽວນີ້ | `.\deploy\backup.ps1` (ແລ່ນເອງທຸກຄືນ ຕີ 3 ຢູ່ແລ້ວ) |
| ເຊັກວ່າ backup ຍັງແລ່ນຢູ່ | `Get-Content .\deploy\logs\backup.log -Tail 20` |

## Backup

`install-backup.ps1` ລົງທະບຽນ task `LaoStay Backup` ໄວ້ແລ້ວ — ແລ່ນ **ຕີ 3 ທຸກຄືນ**
ແລະ ອີກເທື່ອຕອນເຂົ້າເຄື່ອງ. ຜົນລົງທີ່ `deploy\backups\<ວັນທີ_ເວລາ>\` ເກັບໄວ້ 14 ມື້.

ແຕ່ລະ backup ມີ NDJSON ບີບອັດຂອງທຸກຕາຕະລາງ **ບວກກັບໂຟນເດີ `uploads/`** —
ຮູບບໍ່ໄດ້ຢູ່ໃນ Neon ສະນັ້ນ dump ຂອງ Neon ຢ່າງດຽວບໍ່ພຽງພໍ.

```powershell
# ກວດວ່າ backup ອ່ານກັບຄືນໄດ້ (ບໍ່ຂຽນຫຍັງ — ຄວນເຮັດເປັນບາງຄັ້ງ)
cd backend
node scripts/restore-db.mjs ..\deploy\backups\2026-08-18_1457
```

ການ restore ຈິງໃສ່ `--apply` ແລະ ຕ້ອງສ້າງ schema ກ່ອນດ້ວຍ `prisma/migrations-v2/*.sql`
— script ນີ້ເອົາຄືນແຕ່ **ແຖວ** ບໍ່ແມ່ນ schema. ມັນປະຕິເສດເມື່ອ `NODE_ENV=production`
ໂດຍເຈດຕະນາ: ການ restore ທັບຖານຂໍ້ມູນຈິງຕ້ອງເຮັດດ້ວຍມື ແລະ backup ອັນໃໝ່ກ່ອນ.

> ⚠️ backups ຢູ່ disk ດຽວກັນກັບສິ່ງທີ່ມັນປົກປ້ອງ. ກັອບປີ້ໄປໄວ້ບ່ອນອື່ນເປັນບາງໄລຍະ
> (`.\deploy\backup.ps1 -Out E:\ບ່ອນອື່ນ`).

## ຕ້ອງລະວັງ

- **ເຄື່ອງດັບ = ເວັບດັບ.** ບໍ່ມີ instance ອື່ນຮັບແທນ. ຈອງບໍ່ໄດ້, ຮັບເງິນບໍ່ໄດ້.
- **`uploads/` ຢູ່ disk ນີ້.** dump ຂອງ Neon **ບໍ່ມີຮູບ** — `backup.ps1` ຈຶ່ງກັອບປີ້
  `kong/uploads/` ໄປນຳທຸກຄືນ. ຢາກຫຼົບບັນຫານີ້ຖາວອນໃຫ້ຍ້າຍໄປ R2
  (`STORAGE_PROVIDER=r2`, ໂຄ້ດພ້ອມແລ້ວ).
- **`PHAJAY_LIVE=true` = ເງິນຈິງ.** ແຕ່ key ທີ່ໃຊ້ຢູ່ແມ່ນ test key: ຮັບບໍ່ເກີນ
  **999 ກີບ** ແລະ **20 ຄັ້ງ/ມື້**. ຕ້ອງຂໍ key ຈິງຈາກ PhaJay ກ່ອນເປີດຮັບແຂກແທ້.
- **socket ຢ່າງດຽວບໍ່ພຽງພໍ.** `phajay-socket.service.ts` ຮັບການຈ່າຍໄດ້ຢູ່ແລ້ວ ແຕ່ຂາດຕອນ
  ເມື່ອເນັດສະດຸດ. webhook ຄືທາງທີ່ PhaJay ຍິງຊ້ຳໃຫ້ເອງ — ຕ້ອງລົງທະບຽນທັງສອງ.
- **`CORS_ORIGIN` ຕົວທຳອິດຕ້ອງເປັນ `https://phaphak.com`.** `auth.service.ts` ເອົາ
  ຕົວທຳອິດໄປສ້າງ link ກູ້ລະຫັດຜ່ານ. ສະຫຼັບລຳດັບ = ສົ່ງ link ໄປ localhost ໃຫ້ລູກຄ້າ.

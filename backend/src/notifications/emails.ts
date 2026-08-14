import type { Email } from './email-provider.interface';

/**
 * The messages LaoStay sends by email.
 *
 * Kept together and away from the services that trigger them, so the wording
 * can be read and changed without going through business logic.
 *
 * Every one carries both an HTML and a plain-text body. Plain text is not a
 * courtesy: a mail client that will not render HTML shows the text part, and a
 * reset link nobody can read is a reset that did not happen.
 */

/** Inlined because a stylesheet in an email is ignored by most clients. */
const WRAP =
  'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:520px;' +
  'margin:0 auto;padding:32px 24px;color:#2B2521;line-height:1.6';
const BUTTON =
  'display:inline-block;background:#FD4D1C;color:#ffffff;text-decoration:none;' +
  'padding:12px 28px;border-radius:10px;font-weight:700';
const FAINT = 'color:#8C8073;font-size:13px';

export function otpEmail(to: string, code: string, ttlMinutes: number): Email {
  return {
    to,
    subject: `${code} — ລະຫັດຢືນຢັນ LaoStay`,
    text: [
      `ລະຫັດຢືນຢັນຂອງທ່ານແມ່ນ ${code}`,
      '',
      `ໝົດອາຍຸໃນ ${ttlMinutes} ນາທີ. ຢ່າບອກລະຫັດນີ້ໃຫ້ໃຜ.`,
      '',
      'ຖ້າທ່ານບໍ່ໄດ້ຮ້ອງຂໍ ບໍ່ຕ້ອງເຮັດຫຍັງ.',
      '',
      '— LaoStay',
    ].join('\n'),
    html: `<div style="${WRAP}">
  <h1 style="font-size:20px;margin:0 0 16px">ລະຫັດຢືນຢັນ LaoStay</h1>
  <p style="font-size:34px;font-weight:800;letter-spacing:6px;margin:0 0 8px;color:#FD4D1C">${code}</p>
  <p style="${FAINT};margin:0 0 24px">ໝົດອາຍຸໃນ ${ttlMinutes} ນາທີ</p>
  <p style="margin:0 0 24px">ຢ່າບອກລະຫັດນີ້ໃຫ້ໃຜ — ພະນັກງານ LaoStay ຈະບໍ່ຖາມຫາມັນ.</p>
  <hr style="border:none;border-top:1px solid #E4D8C4;margin:24px 0">
  <p style="${FAINT};margin:0">ຖ້າທ່ານບໍ່ໄດ້ຮ້ອງຂໍ ບໍ່ຕ້ອງເຮັດຫຍັງ.</p>
</div>`,
  };
}

export function passwordResetEmail(to: string, link: string, ttlMinutes: number): Email {
  const subject = 'ຕັ້ງລະຫັດຜ່ານ LaoStay ໃໝ່ · Reset your LaoStay password';

  return {
    to,
    subject,
    text: [
      'ຕັ້ງລະຫັດຜ່ານ LaoStay ໃໝ່',
      '',
      `ເປີດລິ້ງນີ້ເພື່ອຕັ້ງລະຫັດຜ່ານໃໝ່ (ໝົດອາຍຸໃນ ${ttlMinutes} ນາທີ):`,
      link,
      '',
      'ຖ້າທ່ານບໍ່ໄດ້ຮ້ອງຂໍ ບໍ່ຕ້ອງເຮັດຫຍັງ — ລະຫັດຜ່ານເກົ່າຍັງໃຊ້ໄດ້ຄືເກົ່າ.',
      '',
      '— LaoStay',
    ].join('\n'),
    html: `<div style="${WRAP}">
  <h1 style="font-size:20px;margin:0 0 16px">ຕັ້ງລະຫັດຜ່ານ LaoStay ໃໝ່</h1>
  <p style="margin:0 0 24px">ກົດປຸ່ມລຸ່ມນີ້ເພື່ອຕັ້ງລະຫັດຜ່ານໃໝ່. ລິ້ງໝົດອາຍຸໃນ ${ttlMinutes} ນາທີ.</p>
  <p style="margin:0 0 24px"><a href="${link}" style="${BUTTON}">ຕັ້ງລະຫັດຜ່ານໃໝ່</a></p>
  <p style="${FAINT};margin:0 0 8px">ຖ້າປຸ່ມກົດບໍ່ໄດ້ ໃຫ້ຄັດລອກລິ້ງນີ້:</p>
  <p style="${FAINT};margin:0 0 24px;word-break:break-all">${link}</p>
  <hr style="border:none;border-top:1px solid #E4D8C4;margin:24px 0">
  <p style="${FAINT};margin:0">ຖ້າທ່ານບໍ່ໄດ້ຮ້ອງຂໍ ບໍ່ຕ້ອງເຮັດຫຍັງ — ລະຫັດຜ່ານເກົ່າຍັງໃຊ້ໄດ້ຄືເກົ່າ.</p>
</div>`,
  };
}

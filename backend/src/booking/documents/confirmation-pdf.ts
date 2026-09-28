import * as path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { enDate, laosInstant, loDate } from './format';

/**
 * The guest's booking confirmation and payment receipt, as one A4 page.
 *
 * Built to travel: PDF/A-2b (ISO 19005-2, the archival profile — fonts and
 * colour profile embedded, so it opens the same on any device years from
 * now), every label in Lao and English, dates spelled out rather than in a
 * locale's numeric order, and money with its ISO 4217 code. It is what a
 * guest shows at a front desk, forwards to a travel companion, or attaches
 * to a visa application.
 *
 * Layout only — everything it prints arrives in [ConfirmationDoc], already
 * scoped to the guest by the caller. Nothing here reads the database.
 */

export type DocStatus = 'confirmed' | 'staying' | 'completed' | 'no_show' | 'cancelled';

export interface ConfirmationDoc {
  code: string;
  status: DocStatus;
  issuedAt: Date;
  guestName: string | null;
  guestPhone: string | null;
  propertyName: string;
  address: string | null;
  propertyPhone: string | null;
  /** Date-only values, stored as UTC midnight. */
  checkIn: Date;
  checkOut: Date;
  nights: number;
  roomName: string | null;
  roomQuantity: number;
  roomNumbers: string[];
  guests: number;
  specialRequest: string | null;
  subtotal: number;
  serviceFee: number;
  tax: number;
  cleaningFee: number;
  discount: number;
  total: number;
  paid: number;
  refunded: number;
  payment: { method: string; paidAt: Date | null } | null;
  cancellation: {
    reason: string | null;
    penalty: number;
    refund: number;
    cancelledAt: Date | null;
  } | null;
  policy: { daysBeforeCheckin: number; penaltyPercent: number; isRefundable: boolean } | null;
  url: string;
  /** Signed check-in URL for the QR; null once there is no check-in left to do. */
  checkInQr: string | null;
}

// Resolved from dist/booking/documents/ (and src/… under ts-node) to the
// package root, where the fonts and logo are checked in.
const ASSETS = path.resolve(__dirname, '..', '..', '..', 'assets');
const FONT = {
  regular: path.join(ASSETS, 'fonts', 'NotoSansLao-Regular.ttf'),
  semibold: path.join(ASSETS, 'fonts', 'NotoSansLao-SemiBold.ttf'),
  bold: path.join(ASSETS, 'fonts', 'NotoSansLao-Bold.ttf'),
};
const LOGO = path.join(ASSETS, 'brand', 'logo.png');

const C = {
  ink: '#2A1F19',
  sub: '#8A7B6F',
  line: '#EDE4D8',
  brand: '#FF5722',
  sand: '#FBF6EF',
  success: '#0A7C4A',
  danger: '#B3261E',
};

const STATUS: Record<DocStatus, { label: string; color: string }> = {
  confirmed: { label: 'ຢືນຢັນແລ້ວ · Confirmed', color: C.success },
  staying: { label: 'ກຳລັງພັກ · Checked in', color: C.success },
  completed: { label: 'ສຳເລັດ · Completed', color: C.sub },
  no_show: { label: 'ບໍ່ມາເຂົ້າພັກ · No-show', color: C.danger },
  cancelled: { label: 'ຍົກເລີກແລ້ວ · Cancelled', color: C.danger },
};

const PAYMENT_METHOD: Record<string, string> = {
  phajay_qr: 'PhaJay QR',
};

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const CONTENT_W = PAGE.width - PAGE.margin * 2;
const FOOTER_TOP = PAGE.height - PAGE.margin - 34;

// ── formatting ──────────────────────────────────────────────────────────────

const kip = (n: number) => new Intl.NumberFormat('en-US').format(n);

/** "ຈັນ, 12 ຕຸລາ 2026 · Mon, 12 Oct 2026" — a stay date is a calendar date. */
const stayDate = (d: Date) => `${loDate(d)} · ${enDate(d)}`;
const instant = laosInstant;

// ── rendering ───────────────────────────────────────────────────────────────

export async function renderConfirmationPdf(d: ConfirmationDoc): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    pdfVersion: '1.7',
    subset: 'PDF/A-2b',
    // The first font pdfkit sets up must already be an embedded one: PDF/A
    // forbids the unembedded standard 14 it would otherwise start with.
    font: FONT.regular,
    lang: 'lo-LA',
    displayTitle: true,
    bufferPages: true,
    info: {
      Title: `PhaPhak booking confirmation ${d.code}`,
      Author: 'PhaPhak',
      Subject: 'Booking confirmation and payment receipt',
      Keywords: `booking, confirmation, receipt, ${d.code}`,
      Creator: 'PhaPhak',
      CreationDate: d.issuedAt,
    },
  });
  doc.registerFont('reg', FONT.regular);
  doc.registerFont('semi', FONT.semibold);
  doc.registerFont('bold', FONT.bold);

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const x0 = PAGE.margin;
  let y = PAGE.margin;

  const ensureSpace = (h: number) => {
    if (y + h > FOOTER_TOP - 12) {
      doc.addPage();
      y = PAGE.margin;
    }
  };

  const rule = (color = C.line, width = 0.8) => {
    doc.moveTo(x0, y).lineTo(x0 + CONTENT_W, y).lineWidth(width).strokeColor(color).stroke();
  };

  const sectionTitle = (text: string, right?: string) => {
    ensureSpace(40);
    y += 16;
    doc.font('semi').fontSize(11).fillColor(C.ink).text(text, x0, y, { width: CONTENT_W });
    if (right) {
      doc.font('semi').fontSize(9).fillColor(C.sub).text(right, x0, y + 2, {
        width: CONTENT_W,
        align: 'right',
      });
    }
    y += 20;
    rule();
    y += 8;
  };

  /** Label on the left, wrapping value on the right. */
  const LABEL_W = 170;
  const kv = (label: string, value: string, opts: { bold?: boolean; color?: string } = {}) => {
    const valueW = CONTENT_W - LABEL_W;
    doc.font(opts.bold ? 'semi' : 'reg').fontSize(10);
    const h = Math.max(doc.heightOfString(value, { width: valueW }), 14);
    ensureSpace(h + 6);
    doc.font('reg').fontSize(9).fillColor(C.sub).text(label, x0, y + 1, { width: LABEL_W - 10 });
    doc
      .font(opts.bold ? 'semi' : 'reg')
      .fontSize(10)
      .fillColor(opts.color ?? C.ink)
      .text(value, x0 + LABEL_W, y, { width: valueW });
    y += h + 6;
  };

  /** Label on the left, amount right-aligned. */
  const money = (label: string, amount: string, opts: { bold?: boolean; color?: string } = {}) => {
    ensureSpace(20);
    const size = opts.bold ? 11.5 : 10;
    doc.font(opts.bold ? 'bold' : 'reg').fontSize(size).fillColor(opts.bold ? C.ink : C.sub)
      .text(label, x0, y, { width: CONTENT_W - 120 });
    doc.font(opts.bold ? 'bold' : 'semi').fontSize(size).fillColor(opts.color ?? C.ink)
      .text(amount, x0 + CONTENT_W - 120, y, { width: 120, align: 'right' });
    y += opts.bold ? 20 : 17;
  };

  // ── header ────────────────────────────────────────────────────────────────
  doc.image(LOGO, x0, y, { width: 48, height: 48 });
  doc.font('bold').fontSize(18).fillColor(C.ink)
    .text('ໃບຢືນຢັນການຈອງ', x0 + 60, y + 2, { width: CONTENT_W - 60, align: 'right' });
  doc.font('reg').fontSize(10).fillColor(C.sub)
    .text('Booking confirmation & payment receipt', x0 + 60, y + 28, { width: CONTENT_W - 60, align: 'right' });
  y += 58;
  doc.font('reg').fontSize(8.5).fillColor(C.sub)
    .text(`ອອກວັນທີ · Issued ${instant(d.issuedAt)}`, x0, y, { width: CONTENT_W, align: 'right' });
  y += 16;
  rule(C.brand, 1.4);
  y += 16;

  // ── confirmation number, status, QR ────────────────────────────────────────
  const QR = 86;
  const blockTop = y;
  doc.font('reg').fontSize(9).fillColor(C.sub).text('ລະຫັດຈອງ · Confirmation no.', x0, y);
  y += 14;
  doc.font('bold').fontSize(24).fillColor(C.ink).text(d.code, x0, y);
  y += 34;
  const status = STATUS[d.status];
  doc.font('semi').fontSize(10.5).fillColor(status.color).text(status.label, x0, y);

  // The signed check-in QR (see CheckinQrService), only while there is a
  // check-in still to do — a finished or cancelled stay gets none, rather
  // than a code the front desk would scan only to be refused.
  if (d.checkInQr) {
    const qr = QRCode.create(d.checkInQr, { errorCorrectionLevel: 'M' });
    const cells = qr.modules.size;
    const cell = QR / cells;
    const qx = x0 + CONTENT_W - QR;
    doc.save().fillColor(C.ink);
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if (qr.modules.get(r, c)) doc.rect(qx + c * cell, blockTop + r * cell, cell, cell);
      }
    }
    doc.fill().restore();
    doc.font('reg').fontSize(7.5).fillColor(C.sub)
      .text('ສະແກນຕອນເຊັກອິນ · Scan at check-in', qx - 40, blockTop + QR + 4, { width: QR + 40, align: 'right' });
    y = Math.max(y + 18, blockTop + QR + 18);
  } else {
    y += 24;
  }

  // ── the stay ──────────────────────────────────────────────────────────────
  sectionTitle('ລາຍລະອຽດການເຂົ້າພັກ · Stay details');
  if (d.guestName) {
    kv('ແຂກ · Guest', d.guestPhone ? `${d.guestName} · ${d.guestPhone}` : d.guestName);
  }
  kv('ທີ່ພັກ · Property', d.propertyName, { bold: true });
  if (d.address) kv('ທີ່ຢູ່ · Address', d.address);
  if (d.propertyPhone) kv('ໂທ · Phone', d.propertyPhone);
  kv('ເຂົ້າພັກ · Check-in', stayDate(d.checkIn), { bold: true });
  kv('ອອກ · Check-out', stayDate(d.checkOut), { bold: true });
  kv('ຈຳນວນຄືນ · Nights', String(d.nights));
  if (d.roomName) {
    const room = d.roomQuantity > 1 ? `${d.roomName} × ${d.roomQuantity}` : d.roomName;
    kv(
      'ຫ້ອງ · Room',
      d.roomNumbers.length ? `${room} · ເລກຫ້ອງ / No. ${d.roomNumbers.join(', ')}` : room,
    );
  }
  kv('ຜູ້ເຂົ້າພັກ · Guests', String(d.guests));
  if (d.specialRequest) kv('ຄວາມຕ້ອງການເພີ່ມເຕີມ · Special requests', d.specialRequest);

  // ── money ─────────────────────────────────────────────────────────────────
  sectionTitle('ລາຍລະອຽດລາຄາ · Price details', 'LAK');
  money(`ຄ່າຫ້ອງ · Room charge (${d.nights} ຄືນ · ${d.nights === 1 ? 'night' : 'nights'})`, kip(d.subtotal));
  if (d.serviceFee > 0) money('ຄ່າບໍລິການ · Service fee', kip(d.serviceFee));
  if (d.tax > 0) money('ອາກອນ · Tax', kip(d.tax));
  if (d.cleaningFee > 0) money('ຄ່າທຳຄວາມສະອາດ · Cleaning fee', kip(d.cleaningFee));
  if (d.discount > 0) money('ສ່ວນຫຼຸດ · Discount', `-${kip(d.discount)}`, { color: C.success });
  y += 2;
  rule();
  y += 8;
  money('ລວມທັງໝົດ · Total', kip(d.total), { bold: true });
  if (d.paid > 0) {
    const via = d.payment
      ? ` — ${PAYMENT_METHOD[d.payment.method] ?? d.payment.method}${d.payment.paidAt ? `, ${instant(d.payment.paidAt)}` : ''}`
      : '';
    money(`ຈ່າຍແລ້ວ · Paid${via}`, kip(d.paid), { color: C.success });
  }
  if (d.refunded > 0) money('ຄືນເງິນແລ້ວ · Refunded', `-${kip(d.refunded)}`);
  const due = d.total - d.paid;
  if (d.status !== 'cancelled' && due > 0) money('ຍັງຄ້າງ · Balance due', kip(due), { color: C.danger });

  // ── cancellation ───────────────────────────────────────────────────────────
  if (d.status === 'cancelled' && d.cancellation) {
    const c = d.cancellation;
    sectionTitle('ການຍົກເລີກ · Cancellation');
    if (c.cancelledAt) kv('ວັນທີ · Date', instant(c.cancelledAt));
    if (c.reason) kv('ເຫດຜົນ · Reason', c.reason);
    kv('ຄ່າປັບ · Penalty', `LAK ${kip(c.penalty)}`);
    kv('ເງິນຄືນ · Refund', `LAK ${kip(c.refund)}`, { bold: true, color: c.refund > 0 ? C.success : C.ink });
  } else if (d.policy) {
    const p = d.policy;
    const hours = p.daysBeforeCheckin * 24;
    const refundPct = Math.round(100 - p.penaltyPercent);
    sectionTitle('ນະໂຍບາຍການຍົກເລີກ · Cancellation policy');
    const lines = p.isRefundable
      ? [
          `ຄືນເງິນ ${refundPct}% ຖ້າຍົກເລີກກ່ອນເຂົ້າພັກຫຼາຍກວ່າ ${hours} ຊົ່ວໂມງ · ${refundPct}% refund if cancelled more than ${hours} hours before check-in.`,
          `ພາຍໃນ ${hours} ຊົ່ວໂມງກ່ອນເຂົ້າພັກ ບໍ່ສາມາດຍົກເລີກໄດ້ · Cannot be cancelled within ${hours} hours of check-in.`,
        ]
      : ['ບໍ່ຄືນເງິນ · Non-refundable.'];
    for (const line of lines) {
      doc.font('reg').fontSize(9.5);
      const h = doc.heightOfString(line, { width: CONTENT_W });
      ensureSpace(h + 4);
      doc.fillColor(C.ink).text(line, x0, y, { width: CONTENT_W });
      y += h + 4;
    }
  }

  // ── watermark and footer, on every page ───────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    if (d.status === 'cancelled') {
      doc.save();
      doc.rotate(-30, { origin: [PAGE.width / 2, PAGE.height / 2] });
      doc.font('bold').fontSize(64).fillColor(C.danger).fillOpacity(0.1)
        .text('CANCELLED', 0, PAGE.height / 2 - 50, { width: PAGE.width, align: 'center', lineBreak: false });
      doc.font('bold').fontSize(34)
        .text('ຍົກເລີກແລ້ວ', 0, PAGE.height / 2 + 22, { width: PAGE.width, align: 'center', lineBreak: false });
      doc.restore();
    }

    const fy = FOOTER_TOP;
    doc.moveTo(x0, fy).lineTo(x0 + CONTENT_W, fy).lineWidth(0.6).strokeColor(C.line).stroke();
    doc.font('reg').fontSize(7.5).fillColor(C.sub);
    doc.text(
      `ອອກໂດຍ PhaPhak · ${d.url.replace(/^https?:\/\//, '').split('/')[0]} — ເອກະສານສ້າງໂດຍລະບົບ ບໍ່ຕ້ອງມີລາຍເຊັນ · Computer-generated; no signature required.`,
      x0, fy + 6, { width: CONTENT_W, lineBreak: false },
    );
    doc.text(
      `ເອກະສານນີ້ບໍ່ແມ່ນໃບເກັບເງິນອາກອນ · This is not a tax invoice.   ${d.code} · ${i - range.start + 1}/${range.count}`,
      x0, fy + 18, { width: CONTENT_W, lineBreak: false },
    );
  }

  doc.end();
  return done;
}

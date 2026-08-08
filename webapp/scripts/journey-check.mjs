/**
 * The whole booking journey, driven in a real browser against the live API.
 *
 * Signs in as the seeded guest, books a room, pays the QR through the dev
 * settle route, checks the booking is confirmed, then cancels it and confirms
 * the refund maths. Writes rows — run it against a database you are willing to
 * add a booking to.
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5174';
const API = 'http://localhost:3100/api';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const EMAIL = 'souda.v@gmail.com';
const PASSWORD = 'Customer@2026';

const problems = [];
const seen = new Set();

function note(kind, text) {
  const key = `${kind}:${text}`;
  if (seen.has(key)) return;
  seen.add(key);
  problems.push(`${kind}  ${text}`);
}

let pass = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`);
  } else {
    problems.push(`${name} — ${detail}`);
    console.log(`  FAIL ${name}  ${detail}`);
  }
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1100 });

page.on('console', (msg) => {
  if (msg.type() === 'error') note('console', msg.text().slice(0, 200));
});
page.on('pageerror', (err) => note('pageerror', String(err.message).slice(0, 200)));
page.on('response', (res) => {
  // 401 on /auth/me before signing in is expected; everything else is not.
  if (res.url().includes('/api/') && res.status() >= 400 && !res.url().endsWith('/auth/me')) {
    note('http', `${res.status()} ${new URL(res.url()).pathname}`);
  }
});

const text = () => page.$eval('body', (b) => b.innerText);
const day = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

console.log('\nBooking journey\n');

// ── sign in ──────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[type="email"]');
await page.type('input[type="email"]', EMAIL);
await page.type('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');

const signedIn = await page
  .waitForFunction(() => document.body.innerText.includes('ການເດີນທາງຂອງຂ້ອຍ'), {
    timeout: 30_000,
  })
  .then(() => true)
  .catch(() => false);
check('a guest can sign in', signedIn);

// A host's credentials must be turned away with an explanation, not a 403 page.
const partnerRefused = await page.evaluate(async (api) => {
  const res = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'vintage@laostay.la', password: 'Partner@2026' }),
  });
  const body = await res.json();
  return body?.user?.role;
}, API);
check('the API would return a PARTNER role that this app must reject', partnerRefused === 'PARTNER');

// ── find something bookable ──────────────────────────────────────────────────
const checkIn = day(25);
const checkOut = day(28);

await page.goto(`${BASE}/search?checkIn=${checkIn}&checkOut=${checkOut}&guests=2`, {
  waitUntil: 'networkidle2',
});
await page.waitForSelector('a[href^="/property/"]', { timeout: 25_000 });
const href = await page.$eval('a[href^="/property/"]', (a) => a.getAttribute('href'));

await page.goto(BASE + href, { waitUntil: 'networkidle2' });
await page.waitForSelector('[data-room-bookable="true"]', { timeout: 25_000 });
await page.click('[data-room-bookable="true"]');
await settle(400);
await page.click('[data-testid="book"]');

// ── checkout ─────────────────────────────────────────────────────────────────
const onCheckout = await page
  .waitForFunction(() => document.body.innerText.includes('ສະຫຼຸບລາຄາ'), { timeout: 25_000 })
  .then(() => true)
  .catch(() => false);
check('the booking button reaches checkout', onCheckout);

await page
  .waitForFunction(() => document.body.innerText.includes('ລວມທັງໝົດ'), { timeout: 25_000 })
  .catch(() => undefined);

const quoteText = await text();
const parseKip = (label) => {
  const re = new RegExp(`${label}[^₭]*₭([\\d,]+)`);
  const m = re.exec(quoteText);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};
const subtotal = parseKip('ຄ່າຫ້ອງ');
const total = parseKip('ລວມທັງໝົດ');
check('the quote shows a subtotal and a total', subtotal !== null && total !== null, `subtotal=${subtotal} total=${total}`);
check('the total is at least the room subtotal', total >= subtotal, `${total} >= ${subtotal}`);

await page.click('[data-testid="confirm-booking"]');

// ── payment ──────────────────────────────────────────────────────────────────
const onPay = await page
  .waitForFunction(() => /\/pay\//.test(location.pathname), { timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
check('confirming creates a booking and lands on the payment page', onPay);

const bookingId = page.url().split('/pay/')[1];

await page
  .waitForFunction(() => document.querySelector('canvas') !== null, { timeout: 25_000 })
  .catch(() => undefined);

const payText = await text();
check('the QR is rendered as a canvas', (await page.$('canvas')) !== null);
check('the hold countdown is shown', /ກັນຫ້ອງໄວ້ອີກ \d+:\d\d/.test(payText), payText.match(/ກັນຫ້ອງໄວ້ອີກ [\d:]+/)?.[0] ?? '');
check('the amount to pay is shown', /₭[\d,]+/.test(payText));

// The QR must carry a real EMVCo payload, not a placeholder.
const qrIsEmvco = await page.evaluate(async (api, id) => {
  const token = localStorage.getItem('laostay.guest.accessToken');
  const res = await fetch(`${api}/customer/bookings/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const b = await res.json();
  const paymentId = b.payments?.[0]?.id;
  if (!paymentId) return null;
  const pr = await fetch(`${api}/customer/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const p = await pr.json();
  return { payload: p.qrPayload, amount: p.amount, total: b.total, paymentId };
}, API, bookingId);

check('the QR payload is EMVCo', qrIsEmvco?.payload?.startsWith('000201') === true, qrIsEmvco?.payload?.slice(0, 20));
check('the QR amount equals the booking total', qrIsEmvco?.amount === qrIsEmvco?.total, `${qrIsEmvco?.amount} vs ${qrIsEmvco?.total}`);

// ── settle, as the bank would ────────────────────────────────────────────────
const settled = await page.evaluate(
  async (api, paymentId) => {
    const res = await fetch(`${api}/payments/dev/settle/${paymentId}`, { method: 'POST' });
    return res.json();
  },
  API,
  qrIsEmvco?.paymentId,
);
check('the dev settle route accepts the payment', settled?.paid === true, JSON.stringify(settled).slice(0, 90));

// The page polls every 4s and then redirects itself to the trip.
const confirmed = await page
  .waitForFunction(() => /\/trips\//.test(location.pathname), { timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
check('the page notices the payment and moves to the trip', confirmed);

await settle(800);
const tripText = await text();
check('the trip reads as confirmed', tripText.includes('ຢືນຢັນແລ້ວ'));
check('the trip shows the payment', tripText.includes('ຈ່າຍແລ້ວ'));

// ── the trips list ───────────────────────────────────────────────────────────
await page.goto(`${BASE}/trips`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.body.innerText.includes('ການເດີນທາງຂອງຂ້ອຍ'), {
  timeout: 20_000,
});
await settle(900);
const trips = await text();
check('the new booking appears in the trips list', trips.includes('STL-'), '');

// ── cancel, and check the refund maths ───────────────────────────────────────
await page.goto(`${BASE}/trips/${bookingId}`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.body.innerText.includes('ຍົກເລີກການຈອງ'), {
  timeout: 20_000,
});
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.innerText.trim() === 'ຍົກເລີກການຈອງ',
  );
  button?.click();
});
await settle(500);

await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.innerText.trim() === 'ຢືນຢັນຍົກເລີກ',
  );
  button?.click();
});

const cancelled = await page
  .waitForFunction(() => document.body.innerText.includes('ຈະຄືນເງິນໃຫ້ທ່ານ'), { timeout: 25_000 })
  .then(() => true)
  .catch(() => false);
check('cancelling reports the refund', cancelled);

if (cancelled) {
  const modal = await text();
  const grab = (label) => {
    const m = new RegExp(`${label}[^₭]*₭([\\d,]+)`).exec(modal);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const paid = grab('ຈ່າຍມາ');
  const penalty = grab('ຄ່າທຳນຽມຍົກເລີກ');
  const refund = grab('ຈະຄືນເງິນໃຫ້ທ່ານ');
  check(
    'penalty + refund equals what was paid',
    paid !== null && penalty + refund === paid,
    `${penalty} + ${refund} = ${paid}`,
  );
}

await browser.close();

console.log('');
if (problems.length) {
  console.log(`  ${pass} passed · ${problems.length} problem(s):\n`);
  for (const p of problems) console.log(`  · ${p}`);
  console.log('');
  process.exit(1);
}
console.log(`  ${pass} passed · no console errors, page errors or unexpected 4xx/5xx.\n`);

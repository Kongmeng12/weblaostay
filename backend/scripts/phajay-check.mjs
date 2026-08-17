/**
 * The PhaJay adapter, against a stub of their gateway.
 *
 * No network and no database: `fetch` is replaced so the request we would send
 * can be inspected, which is the part that has to be right before real money
 * is involved.
 */
const { PhaJayPaymentProvider } = await import('../dist/payments/phajay.provider.js');

let pass = 0;
const problems = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`);
  } else {
    problems.push(name);
    console.log(`  FAIL ${name}  ${detail}`);
  }
};

const cfg = (values) => ({
  get: (k, fallback) => (values[k] !== undefined ? values[k] : fallback),
});

/** Captures the outgoing request and replies as PhaJay documents. */
function stubGateway(reply) {
  const seen = {};
  globalThis.fetch = async (url, init) => {
    seen.url = String(url);
    seen.headers = init.headers;
    seen.body = JSON.parse(init.body);
    return { ok: true, text: async () => JSON.stringify(reply) };
  };
  return seen;
}

const QR =
  '00020101021133730004BCEL0106ONEPAY0216mch6542c0373ede30314202403271909590513CLOSEWHENDONE5303418540510000580' +
  '3VTE6002LA625305368cc876b4-a4af-4886-81f1-3890453eb5560809Buy Pants630440FF';

const REPLY = {
  message: 'SUCCESSFULLY',
  transactionId: '8cc876b4-a4af-4886-81f1-3890453eb656',
  qrCode: QR,
  link: `onepay://qr/${QR}`,
};

const charge = { bookingId: 42n, amountKip: 500000, reference: 'STL-0079', description: 'x' };

console.log('\nPhaJay — Generate QR\n');

// ── the request we send ─────────────────────────────────────────────────────
{
  const seen = stubGateway(REPLY);
  const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'test-key' }));
  const out = await p.createCharge(charge);

  check('BCEL is the default bank', seen.url.endsWith('/generate-bcel-qr'), seen.url);
  check(
    'the sandbox is used off production — the live endpoints move real money',
    seen.url.includes('/v1/api/test/payment/'),
    seen.url,
  );
  check('the key goes in the secretKey header', seen.headers.secretKey === 'test-key');
  check('no Basic auth — that is the Payment Link endpoint', !seen.headers.Authorization);
  check('the amount is sent as given', seen.body.amount === 500000, String(seen.body.amount));
  check('our reference rides in tag1', seen.body.tag1 === 'STL-0079', seen.body.tag1);

  check('the QR comes back ready to draw', out.qrPayload === QR);
  check('the bank deep link is passed through', out.deepLink === REPLY.link);
  check('the transaction id is kept', out.providerRef === REPLY.transactionId);
}

// ── a key listed in .env but left blank ─────────────────────────────────────
// `ConfigService.get(key, fallback)` returns '' for `PHAJAY_BASE_URL=`, not the
// fallback — which once produced a request to the empty host.
{
  const seen = stubGateway(REPLY);
  const p = new PhaJayPaymentProvider(
    cfg({ PHAJAY_API_KEY: 'k', PHAJAY_BASE_URL: '', PHAJAY_BANK: '', PHAJAY_QR_TTL_MIN: '' }),
  );
  const out = await p.createCharge(charge);
  check(
    'a blank value falls back instead of building an empty URL',
    seen.url.startsWith('https://payment-gateway.phajay.co/'),
    seen.url,
  );
  check('a blank bank still means bcel', seen.url.endsWith('/generate-bcel-qr'));
  check('a blank TTL still expires', out.expiresAt > new Date());
  check('the full amount is sent — nothing caps it', seen.body.amount === 500000);
}

// ── only production reaches the live endpoints ──────────────────────────────
{
  const seen = stubGateway(REPLY);
  const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'k', NODE_ENV: 'production' }));
  await p.createCharge(charge);
  check(
    'production reaches the live endpoint',
    seen.url.includes('/v1/api/payment/') && !seen.url.includes('/test/'),
    seen.url,
  );
}
{
  const seen = stubGateway(REPLY);
  const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'k', NODE_ENV: 'staging' }));
  await p.createCharge(charge);
  check('anything else stays in the sandbox', seen.url.includes('/test/'), seen.url);
}

// ── the switch that decides whether money is real ───────────────────────────
// PHAJAY_LIVE is separate from NODE_ENV on purpose: NODE_ENV also governs OTP
// codes in responses, dev/settle and the db:reset guard, and proving a payment
// works should not require turning all of that off. Which means this one flag
// is the only thing standing between a test and a real charge.
{
  const seen = stubGateway(REPLY);
  const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'k', PHAJAY_LIVE: 'true' }));
  await p.createCharge(charge);
  check(
    'PHAJAY_LIVE=true reaches the live endpoint from a dev machine',
    !seen.url.includes('/test/'),
    seen.url,
  );
}
{
  const seen = stubGateway(REPLY);
  const p = new PhaJayPaymentProvider(
    cfg({ PHAJAY_API_KEY: 'k', PHAJAY_LIVE: 'false', NODE_ENV: 'production' }),
  );
  await p.createCharge(charge);
  check('PHAJAY_LIVE=false keeps production in the sandbox', seen.url.includes('/test/'), seen.url);
}
{
  // Anything that is not exactly "true" must not spend money — a typo in .env
  // should fail safe, not charge a guest.
  for (const value of ['TRUE', 'yes', '1', 'on', '']) {
    const seen = stubGateway(REPLY);
    const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'k', PHAJAY_LIVE: value }));
    await p.createCharge(charge);
    const sandboxed = seen.url.includes('/test/');
    // 'TRUE' is accepted — the read is case-insensitive. A blank falls back to
    // NODE_ENV, which is undefined here, so it stays in the sandbox too.
    const expected = value.toLowerCase() !== 'true';
    check(
      `PHAJAY_LIVE="${value}" → ${expected ? 'sandbox' : 'live'}`,
      sandboxed === expected,
      seen.url,
    );
  }
}

// ── picking another bank ────────────────────────────────────────────────────
{
  const seen = stubGateway(REPLY);
  const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'k', PHAJAY_BANK: 'jdb' }));
  await p.createCharge(charge);
  check('PHAJAY_BANK selects the endpoint', seen.url.endsWith('/generate-jdb-qr'), seen.url);
}
{
  const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'k', PHAJAY_BANK: 'barclays' }));
  const err = await p.createCharge(charge).then(() => null, (e) => e.message);
  check('an unknown bank is refused by name', String(err).includes('barclays'), String(err).slice(0, 60));
}

// ── BCEL rejects Lao text in the description ────────────────────────────────
{
  const seen = stubGateway(REPLY);
  const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'k' }));
  await p.createCharge({ ...charge, description: 'LaoStay STL-0079 · ບ້ານພັກສະບາຍດີ' });
  check(
    'Lao characters are stripped for BCEL, booking code kept',
    /^[\x20-\x7E]*$/.test(seen.body.description) && seen.body.description.includes('STL-0079'),
    seen.body.description,
  );
}
{
  const seen = stubGateway(REPLY);
  const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'k', PHAJAY_BANK: 'jdb' }));
  await p.createCharge({ ...charge, description: 'ບ້ານພັກສະບາຍດີ' });
  check('other banks keep the Lao description', seen.body.description === 'ບ້ານພັກສະບາຍດີ');
}

// ── a reply with no QR must not become a payment ────────────────────────────
{
  stubGateway({ message: 'FAILED' });
  const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'k' }));
  const err = await p.createCharge(charge).then(() => 'accepted anyway', (e) => e.message);
  check('a reply with no qrCode is refused', String(err).includes('QR'), String(err).slice(0, 50));
}

// ── the callback ────────────────────────────────────────────────────────────
{
  const p = new PhaJayPaymentProvider(cfg({ PHAJAY_API_KEY: 'k' }));
  const body = (o) => Buffer.from(JSON.stringify(o));

  const paid = p.verifyCallback(
    body({ status: 'PAYMENT_COMPLETED', tag1: 'STL-0079', txnAmount: 500000, transactionId: 'T1' }),
    {},
  );
  check('a completed callback reads as paid', paid.ok && paid.status === 'paid');
  check('the reference is read from tag1', paid.reference === 'STL-0079');
  check('the amount is read', paid.amountKip === 500000);

  const failed = p.verifyCallback(body({ status: 'PAYMENT_FAILED', tag1: 'STL-0079' }), {});
  check('any other status is not paid', failed.ok && failed.status === 'failed', failed.reason);

  const nameless = p.verifyCallback(body({ status: 'PAYMENT_COMPLETED' }), {});
  check('a callback naming no payment is refused', !nameless.ok, nameless.reason);

  const junk = p.verifyCallback(Buffer.from('not json'), {});
  check('a body that is not JSON is refused', !junk.ok, junk.reason);

  // Payment Link sends orderNo instead of tag1.
  const viaLink = p.verifyCallback(
    body({ status: 'PAYMENT_COMPLETED', orderNo: 'STL-0080', txnAmount: 1 }),
    {},
  );
  check('a Payment Link callback settles through the same path', viaLink.reference === 'STL-0080');
}

console.log('');
if (problems.length) {
  console.log(`  ${pass} passed · ${problems.length} problem(s)\n`);
  process.exit(1);
}
console.log(`  ${pass} passed\n`);

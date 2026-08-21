/**
 * The SMS adapter, against a stub of Wenova's gateway.
 *
 * No network and no database: `fetch` is replaced so the request we would send
 * can be inspected. Phone normalisation gets the most attention here — every
 * number in the database is stored in a shape Wenova refuses, so a mistake in
 * that one function silently loses every message.
 */
const { laoMobile } = await import('../dist/notifications/sms-provider.interface.js');
const { WenovaSmsProvider } = await import('../dist/notifications/wenova.sms.provider.js');
const { ConsoleSmsProvider } = await import('../dist/notifications/console.sms.provider.js');

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

function stubGateway(reply) {
  const seen = {};
  globalThis.fetch = async (url, init) => {
    seen.url = String(url);
    seen.headers = init.headers;
    seen.body = JSON.parse(init.body);
    return { ok: (reply.statusCode ?? 200) < 300, status: reply.statusCode ?? 200,
             text: async () => JSON.stringify(reply) };
  };
  return seen;
}

const DELIVERED = { success: true, data: { resultCode: 20000, resultDesc: 'success' } };

/** What Wenova actually answers: queued, with the verdict still to come. */
const QUEUED = {
  success: true,
  data: { transaction_id: 'WENOVA20260814', resultCode: null, resultDesc: null },
};

console.log('\nSMS — Wenova Link\n');

// ── the number ──────────────────────────────────────────────────────────────
// Wenova takes `2055110001` and nothing else. The database holds
// `+856 20 5511 0001`, so every send depends on this conversion.
{
  const same = [
    '+856 20 5511 0001',
    '+8562055110001',
    '856 20 5511 0001',
    '020 5511 0001',
    '02055110001',
    '2055110001',
    '20 5511 0001',
    ' +856-20-5511-0001 ',
  ];
  const got = same.map(laoMobile);
  check(
    'every way of writing one number gives one number',
    got.every((g) => g === '2055110001'),
    got.filter((g) => g !== '2055110001').join(' ') || '2055110001',
  );

  const refused = [
    ['021 260 000', 'a landline cannot receive SMS'],
    ['2055110', 'too short'],
    ['205511000123', 'too long'],
    ['+66 81 234 5678', 'not a Lao number'],
    ['', 'empty'],
    ['not a phone', 'no digits'],
  ];
  for (const [input, why] of refused) {
    check(`refused: ${why}`, laoMobile(input) === null, JSON.stringify(input));
  }
}

// ── the request we send ─────────────────────────────────────────────────────
{
  const seen = stubGateway(DELIVERED);
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '42' }));
  await p.send('+856 20 5511 0001', 'PhaPhak code: 123456');

  check('POST /sms/package', seen.url.endsWith('/sms/package'), seen.url);
  check('the number is normalised on the way out', seen.body.phoneNumber === '2055110001');
  check('scriptId is sent as a number', seen.body.scriptId === 42);
}

// ── the dashboard shows the id grouped ──────────────────────────────────────
// `884-123-456-789-030`, not `884123456789030`. Number() on the displayed form
// is NaN, which comes back from Wenova as 30308 "scriptId not found".
{
  const seen = stubGateway(DELIVERED);
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '884-123-456-789-030' }));
  await p.send('2055110001', 'x');
  check('separators are stripped from the script id', seen.body.scriptId === 884123456789030);
  check('and it is a real number, not NaN', Number.isSafeInteger(seen.body.scriptId));
}
{
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '1234-5678-9012-3456-7890' }));
  const err = await p.send('2055110001', 'x').then(() => null, (e) => e.message);
  check('an id too long to be an exact number is refused', /too many digits/.test(String(err)));
}
{
  const seen = stubGateway(DELIVERED);
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '42' }));
  await p.send('2055110001', 'x');
  check('no token when a scriptId is set', seen.body.token === undefined);
  check('no Authorization header — this endpoint takes the key in the body', !seen.headers.Authorization);
  check('usePackage defaults to the prepaid package', seen.body.usePackage === true);
  check('the sender defaults to WNV-OTP', seen.body.header === 'WNV-OTP');
}

// ── the token is the fallback, and only that ────────────────────────────────
{
  const seen = stubGateway(DELIVERED);
  const p = new WenovaSmsProvider(cfg({ WENOVA_API_TOKEN: 'tok' }));
  await p.send('2055110001', 'x');
  check('the token is used when no scriptId is set', seen.body.token === 'tok');
  check('no scriptId alongside it', seen.body.scriptId === undefined);
}
{
  // A key listed in .env but left blank gives '' — not undefined — so a naive
  // fallback would send an empty credential and get 30307 back.
  const seen = stubGateway(DELIVERED);
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '  ', WENOVA_API_TOKEN: 'tok' }));
  await p.send('2055110001', 'x');
  check('a blank scriptId falls through to the token', seen.body.token === 'tok');
}
{
  const p = new WenovaSmsProvider(cfg({}));
  const err = await p.send('2055110001', 'x').then(() => null, (e) => e.message);
  check('no credential at all is refused by name', /WENOVA_SCRIPT_ID/.test(String(err)));
}

// ── usePackage ──────────────────────────────────────────────────────────────
{
  const seen = stubGateway(DELIVERED);
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '1', WENOVA_USE_PACKAGE: 'false' }));
  await p.send('2055110001', 'x');
  check('WENOVA_USE_PACKAGE=false spends the wallet instead', seen.body.usePackage === false);
}

// ── links are refused before they cost anything ─────────────────────────────
{
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '1' }));
  for (const text of ['Open https://phaphak.la', 'go to www.phaphak.la', 'see phaphak.la now']) {
    const err = await p.send('2055110001', text).then(() => null, (e) => e.message);
    check(`a link is caught here, not at the gateway`, /ລິ້ງ|link/.test(String(err)), text);
  }
}

// ── a rejected request is not a success ─────────────────────────────────────
{
  stubGateway({ statusCode: 404, code: 30105,
                message: { message: 'SMS package quota is insufficient' } });
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '1' }));
  const err = await p.send('2055110001', 'x').then(() => 'sent anyway', (e) => e.message);
  check('a business-code refusal throws with the code', /30105/.test(String(err)), String(err).slice(0, 60));
}
{
  // HTTP 200 with a gateway verdict that is not delivery. Nothing was charged,
  // so nothing was sent.
  stubGateway({ success: true, data: { resultCode: 40001, resultDesc: 'invalid header' } });
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '1' }));
  const err = await p.send('2055110001', 'x').then(() => 'sent anyway', (e) => e.message);
  check('a 200 that did not deliver is still a failure', err !== 'sent anyway', String(err).slice(0, 50));
}
{
  // Wenova answers as soon as the message is queued; the network's verdict
  // arrives later. Reading that null as a failure would make the provider throw
  // on every message it had just sent successfully.
  stubGateway(QUEUED);
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '1' }));
  const err = await p.send('2055110001', 'x').then(() => null, (e) => e.message);
  check('a queued message with no resultCode yet counts as sent', err === null, String(err ?? ''));
}
{
  // The real 404 shape: nested message, no `code`.
  stubGateway({ statusCode: 404,
                message: { message: 'Package not foud', error: 'Not Found', statusCode: 404 } });
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '1' }));
  const err = await p.send('2055110001', 'x').then(() => 'sent anyway', (e) => e.message);
  check('an empty SMS package is reported by name', /Package not foud/.test(String(err)),
        String(err).slice(0, 60));
}
{
  // And the 400 shape: message is an array of validation lines.
  stubGateway({ statusCode: 400,
                message: { message: ['scriptId must be an integer number'], statusCode: 400 } });
  const p = new WenovaSmsProvider(cfg({ WENOVA_SCRIPT_ID: '1' }));
  const err = await p.send('2055110001', 'x').then(() => 'sent anyway', (e) => e.message);
  check('a validation array is flattened into the error', /integer number/.test(String(err)));
}

// ── the console provider ────────────────────────────────────────────────────
{
  const p = new ConsoleSmsProvider();
  await p.send('+856 20 5511 0001', 'PhaPhak code: 123456');
  check('the console provider accepts a stored number', true);
  const err = await p.send('021 260 000', 'x').then(() => null, (e) => e.message);
  check('and still refuses a landline, so bad numbers surface early', err !== null);
}

console.log('');
if (problems.length) {
  console.log(`  ${pass} passed · ${problems.length} problem(s)\n`);
  process.exit(1);
}
console.log(`  ${pass} passed\n`);

/**
 * End-to-end smoke test against a running API.
 *
 *   npm run start:dev      (in one terminal)
 *   npm run smoke          (in another)
 *
 * Logs in as each seeded role, exercises every endpoint across all three APIs,
 * and asserts the boundaries actually hold — a staff account must be refused at
 * the payout endpoints, a partner must not see another partner's bookings, and
 * a partner token must not be accepted on an admin route.
 *
 * Run `npm run seed` first: the checks assume the seeded accounts, the 60 days
 * of forward availability, and the promo codes it creates.
 */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3100/api';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'LaoStay@2026';
// Fixed by the seed, which upserts both sets of accounts on every run.
const PARTNER_PASSWORD = 'Partner@2026';
const CUSTOMER_PASSWORD = 'Customer@2026';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, detail = '') {
  pass++;
  console.log(`  \x1b[32mPASS\x1b[0m  ${name}${detail ? '  ' + detail : ''}`);
}
function bad(name, detail) {
  fail++;
  failures.push(`${name} — ${detail}`);
  console.log(`  \x1b[31mFAIL\x1b[0m  ${name}  ${detail}`);
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body is fine */
  }
  return { status: res.status, body: json };
}

/** Asserts the status code, and optionally a predicate over the payload. */
async function expect(name, method, path, opts = {}) {
  const { token, body, status = 200, check } = opts;
  const res = await call(method, path, { token, body });
  if (res.status !== status) {
    bad(name, `expected ${status}, got ${res.status} ${JSON.stringify(res.body)?.slice(0, 140)}`);
    return null;
  }
  if (check) {
    const problem = check(res.body);
    if (problem) {
      bad(name, problem);
      return null;
    }
  }
  ok(name, summarise(res.body));
  return res.body;
}

function summarise(body) {
  if (!body || typeof body !== 'object') return '';
  if (Array.isArray(body)) return `[${body.length}]`;
  if (Array.isArray(body.items)) return `items=${body.items.length} total=${body.total ?? '?'}`;
  return '';
}

async function login(email) {
  const res = await call('POST', '/auth/admin/login', { body: { email, password: PASSWORD } });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function loginAs(kind, email, password) {
  const res = await call('POST', `/auth/${kind}/login`, { body: { email, password } });
  if (res.status !== 200) {
    throw new Error(`${kind} login failed for ${email}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/** `YYYY-MM-DD`, `n` days from today in UTC — the form every date param takes. */
function day(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A one-pixel PNG, for the upload checks. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Multipart upload — fetch builds the body, so no boundary handling here. */
async function upload(path, token, { filename = 'photo.png', type = 'image/png', bytes = PNG_1PX } = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);

  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body is fine */
  }
  return { status: res.status, body: json };
}

async function expectUpload(name, path, token, opts = {}) {
  const { status = 201, check, ...fileOpts } = opts;
  const res = await upload(path, token, fileOpts);
  if (res.status !== status) {
    bad(name, `expected ${status}, got ${res.status} ${JSON.stringify(res.body)?.slice(0, 140)}`);
    return null;
  }
  if (check) {
    const problem = check(res.body);
    if (problem) {
      bad(name, problem);
      return null;
    }
  }
  ok(name);
  return res.body;
}

async function main() {
  console.log(`\nSmoke test → ${BASE}\n`);

  // ── health ────────────────────────────────────────────────────────────────
  console.log('health');
  await expect('GET /health', 'GET', '/health', {
    check: (b) => (b?.database === 'connected' ? null : 'database not connected'),
  });

  // ── auth ──────────────────────────────────────────────────────────────────
  console.log('\nauth');
  const superAdmin = await login('amnuay@laostay.la');
  ok('POST /auth/admin/login (super_admin)');
  const finance = await login('bounmy@laostay.la');
  ok('POST /auth/admin/login (finance)');
  const staff = await login('phonsy@laostay.la');
  ok('POST /auth/admin/login (staff)');

  const T = superAdmin.accessToken;

  await expect('POST /auth/admin/login rejects a wrong password', 'POST', '/auth/admin/login', {
    body: { email: 'amnuay@laostay.la', password: 'definitely-not-it' },
    status: 401,
  });
  await expect('GET /auth/me', 'GET', '/auth/me', {
    token: T,
    check: (b) => (b?.role === 'super_admin' ? null : `unexpected role ${b?.role}`),
  });
  await expect('GET /admin/bookings without a token is refused', 'GET', '/admin/bookings', {
    status: 401,
  });

  const refreshed = await expect('POST /auth/refresh rotates the token', 'POST', '/auth/refresh', {
    body: { refreshToken: superAdmin.refreshToken },
    check: (b) => (b?.accessToken ? null : 'no accessToken returned'),
  });
  if (refreshed) {
    await expect('POST /auth/refresh rejects a reused token', 'POST', '/auth/refresh', {
      body: { refreshToken: superAdmin.refreshToken },
      status: 401,
    });
  }

  // Refresh-reuse detection revokes every session for that admin, so continue
  // with a fresh login rather than the now-dead token.
  const fresh = await login('amnuay@laostay.la');
  const A = fresh.accessToken;

  // ── dashboard ─────────────────────────────────────────────────────────────
  console.log('\ndashboard');
  await expect('GET /admin/dashboard/kpis', 'GET', '/admin/dashboard/kpis', {
    token: A,
    check: (b) =>
      typeof b?.revenue?.value === 'number' && typeof b?.bookings?.value === 'number'
        ? null
        : 'kpi payload shape is wrong',
  });
  await expect('GET /admin/dashboard/gmv', 'GET', '/admin/dashboard/gmv?days=14', {
    token: A,
    check: (b) => (b?.series?.length === 14 ? null : `expected 14 points, got ${b?.series?.length}`),
  });
  await expect('GET /admin/dashboard/recent-bookings', 'GET', '/admin/dashboard/recent-bookings', {
    token: A,
    check: (b) => (Array.isArray(b) && b.length ? null : 'no recent bookings'),
  });
  await expect('GET /admin/dashboard/payout-summary', 'GET', '/admin/dashboard/payout-summary', {
    token: A,
  });

  // ── bookings ──────────────────────────────────────────────────────────────
  console.log('\nbookings');
  const bookings = await expect('GET /admin/bookings', 'GET', '/admin/bookings?limit=5', {
    token: A,
    check: (b) => (b?.items?.length ? null : 'no bookings returned'),
  });
  await expect('GET /admin/bookings?status=done', 'GET', '/admin/bookings?status=done&limit=3', {
    token: A,
  });
  await expect('GET /admin/bookings/status-counts', 'GET', '/admin/bookings/status-counts', {
    token: A,
  });
  if (bookings?.items?.length) {
    const first = bookings.items[0];
    await expect('GET /admin/bookings/:id', 'GET', `/admin/bookings/${first.id}`, {
      token: A,
      check: (b) => (b?.code ? null : 'detail missing booking code'),
    });
    await expect(
      'GET /admin/bookings?q=<code> finds it',
      'GET',
      `/admin/bookings?q=${encodeURIComponent(first.code)}`,
      { token: A, check: (b) => (b?.items?.length ? null : 'search by code returned nothing') },
    );
  }

  // ── customers ─────────────────────────────────────────────────────────────
  console.log('\ncustomers');
  const customers = await expect('GET /admin/customers', 'GET', '/admin/customers', { token: A });
  await expect('GET /admin/customers/summary', 'GET', '/admin/customers/summary', { token: A });
  if (customers?.items?.length) {
    await expect('GET /admin/customers/:id', 'GET', `/admin/customers/${customers.items[0].id}`, {
      token: A,
    });
  }

  // ── approvals ─────────────────────────────────────────────────────────────
  console.log('\napprovals');
  const approvals = await expect('GET /admin/approvals', 'GET', '/admin/approvals', {
    token: A,
    check: (b) => (Array.isArray(b) ? null : 'expected an array'),
  });
  await expect('GET /admin/approvals/counts', 'GET', '/admin/approvals/counts', { token: A });

  // ── partners ──────────────────────────────────────────────────────────────
  console.log('\npartners');
  await expect('GET /admin/partners', 'GET', '/admin/partners', { token: A });
  await expect('GET /admin/partners/provinces', 'GET', '/admin/partners/provinces', { token: A });

  // ── reviews ───────────────────────────────────────────────────────────────
  console.log('\nreviews');
  const reviews = await expect('GET /admin/reviews', 'GET', '/admin/reviews', { token: A });
  await expect('GET /admin/reviews?flagged=true', 'GET', '/admin/reviews?flagged=true', {
    token: A,
    check: (b) =>
      b.items.every((r) => r.isFlagged) ? null : 'flagged filter returned unflagged reviews',
  });
  await expect('GET /admin/reviews/counts', 'GET', '/admin/reviews/counts', { token: A });

  // ── promos ────────────────────────────────────────────────────────────────
  console.log('\npromos');
  await expect('GET /admin/promos', 'GET', '/admin/promos', { token: A });
  const promoCode = `SMOKE${Date.now().toString().slice(-6)}`;
  const created = await expect('POST /admin/promos', 'POST', '/admin/promos', {
    token: A,
    status: 201,
    body: { code: promoCode, type: 'percent', value: 10, expiresAt: '2027-01-01' },
  });
  await expect('POST /admin/promos rejects percent > 100', 'POST', '/admin/promos', {
    token: A,
    status: 400,
    body: { code: promoCode + 'X', type: 'percent', value: 150, expiresAt: '2027-01-01' },
  });
  if (created) {
    await expect('PATCH /admin/promos/:id', 'PATCH', `/admin/promos/${created.id}`, {
      token: A,
      body: { value: 12 },
    });
    await expect('DELETE /admin/promos/:id', 'DELETE', `/admin/promos/${created.id}`, { token: A });
  }

  // ── settings ──────────────────────────────────────────────────────────────
  console.log('\nsettings');
  await expect('GET /admin/settings', 'GET', '/admin/settings', {
    token: A,
    check: (b) => (b?.commission_rate === 5 ? null : `commission_rate is ${b?.commission_rate}`),
  });
  await expect('GET /admin/settings/admins', 'GET', '/admin/settings/admins', {
    token: A,
    check: (b) => (b?.length >= 3 ? null : `expected >= 3 admins, got ${b?.length}`),
  });
  await expect('GET /admin/settings/audit-logs', 'GET', '/admin/settings/audit-logs', { token: A });

  // ── payouts + RBAC ────────────────────────────────────────────────────────
  console.log('\npayouts and RBAC');
  const payouts = await expect('GET /admin/payouts (finance)', 'GET', '/admin/payouts', {
    token: finance.accessToken,
    check: (b) => (Array.isArray(b?.items) ? null : 'expected items array'),
  });
  await expect('GET /admin/payouts is refused for staff', 'GET', '/admin/payouts', {
    token: staff.accessToken,
    status: 403,
  });
  await expect('POST /admin/payouts/pay-all is refused for staff', 'POST', '/admin/payouts/pay-all', {
    token: staff.accessToken,
    status: 403,
  });
  await expect('POST /admin/bookings/:id/cancel is refused for staff', 'POST', '/admin/bookings/1/cancel', {
    token: staff.accessToken,
    status: 403,
  });
  await expect('POST /admin/settings/admins is refused for finance', 'POST', '/admin/settings/admins', {
    token: finance.accessToken,
    status: 403,
    body: { email: 'nope@laostay.la', name: 'Nope', password: 'Password123', role: 'staff' },
  });

  // Commission arithmetic must be exact, not approximately right.
  if (payouts?.items?.length) {
    const wrong = payouts.items.filter((p) => p.gmv !== p.commission + p.netAmount);
    if (wrong.length) bad('payout maths: gmv === commission + net', `${wrong.length} row(s) do not balance`);
    else ok('payout maths: gmv === commission + net', `${payouts.items.length} rows checked`);
  }

  // ── audit trail ───────────────────────────────────────────────────────────
  console.log('\naudit trail');
  const before = await call('GET', '/admin/settings/audit-logs?limit=1', { token: A });
  if (approvals?.length) {
    const target = approvals[0];
    await expect('PATCH /admin/approvals/:id/approve', 'PATCH', `/admin/approvals/${target.id}/approve`, {
      token: A,
      check: (b) => (b?.status === 'verified' ? null : `status is ${b?.status}`),
    });
    await expect(
      'PATCH /admin/approvals/:id/approve twice is rejected',
      'PATCH',
      `/admin/approvals/${target.id}/approve`,
      { token: A, status: 400 },
    );

    // The interceptor writes asynchronously; give it a moment to land.
    await new Promise((r) => setTimeout(r, 700));
    const after = await call('GET', '/admin/settings/audit-logs?limit=1', { token: A });
    if ((after.body?.total ?? 0) > (before.body?.total ?? 0)) {
      ok('approve_partner wrote an audit_logs row', `total ${before.body?.total} → ${after.body?.total}`);
    } else {
      bad('approve_partner wrote an audit_logs row', `total stayed at ${after.body?.total}`);
    }
  }

  // ── partner auth and tenant isolation ─────────────────────────────────────
  console.log('\npartner auth');
  const partnerA = await loginAs('partner', 'vintage@laostay.la', PARTNER_PASSWORD);
  ok('POST /auth/partner/login');
  const partnerB = await loginAs('partner', 'homsabay@laostay.la', PARTNER_PASSWORD);
  ok('POST /auth/partner/login (second partner)');
  const P = partnerA.accessToken;

  await expect('GET /auth/partner/me', 'GET', '/auth/partner/me', {
    token: P,
    check: (b) => (b?.email === 'vintage@laostay.la' ? null : `unexpected email ${b?.email}`),
  });

  // The three actors share one signing secret, so the `typ` claim is the only
  // thing keeping them apart. These two checks are that guarantee.
  await expect('a partner token is refused on an admin route', 'GET', '/admin/bookings', {
    token: P,
    status: 401,
  });
  await expect('an admin token is refused on a partner route', 'GET', '/partner/properties', {
    token: A,
    status: 401,
  });

  await expect('POST /auth/partner/login rejects a wrong password', 'POST', '/auth/partner/login', {
    body: { email: 'vintage@laostay.la', password: 'definitely-not-it' },
    status: 401,
  });

  const newPartnerEmail = `applicant-${Date.now()}@laostay.la`;
  const application = await expect(
    'POST /auth/partner/register creates a pending application',
    'POST',
    '/auth/partner/register',
    {
      status: 201,
      body: {
        email: newPartnerEmail,
        password: 'Applicant@2026',
        ownerName: 'ທ້າວ ທົດສອບ',
        phone: '+856 20 1111 2222',
        propertyName: 'Smoke Test Guesthouse',
        propertyType: 'guesthouse',
        province: 'ນະຄອນຫຼວງວຽງຈັນ',
        address: 'ບ້ານທົດສອບ ເມືອງຈັນທະບູລີ',
      },
      check: (b) => (b?.partner?.status === 'pending' ? null : `status is ${b?.partner?.status}`),
    },
  );
  await expect('POST /auth/partner/register rejects a duplicate email', 'POST', '/auth/partner/register', {
    status: 409,
    body: {
      email: newPartnerEmail,
      password: 'Applicant@2026',
      ownerName: 'ທ້າວ ທົດສອບ',
      phone: '+856 20 1111 2222',
      propertyName: 'Smoke Test Guesthouse',
      propertyType: 'guesthouse',
      province: 'ນະຄອນຫຼວງວຽງຈັນ',
      address: 'ບ້ານທົດສອບ ເມືອງຈັນທະບູລີ',
    },
  });
  if (application) {
    await expect(
      'a pending partner cannot create a property',
      'POST',
      '/partner/properties',
      {
        token: application.accessToken,
        status: 403,
        body: {
          name: 'Second Place',
          type: 'hotel',
          province: 'ນະຄອນຫຼວງວຽງຈັນ',
          address: 'ບ້ານໃດໜຶ່ງ',
        },
      },
    );
  }

  // ── partner api ───────────────────────────────────────────────────────────
  console.log('\npartner api');
  const partnerProps = await expect('GET /partner/properties', 'GET', '/partner/properties', {
    token: P,
    check: (b) => (Array.isArray(b) && b.length ? null : 'no properties returned'),
  });
  await expect('GET /partner/dashboard', 'GET', '/partner/dashboard', {
    token: P,
    check: (b) => (typeof b?.occupancy?.percent === 'number' ? null : 'dashboard shape is wrong'),
  });
  await expect('GET /partner/payouts', 'GET', '/partner/payouts', {
    token: P,
    check: (b) => (Array.isArray(b?.items) ? null : 'no payout items array'),
  });
  await expect('GET /partner/reviews', 'GET', '/partner/reviews', { token: P });
  await expect('GET /partner/bookings', 'GET', '/partner/bookings?limit=5', { token: P });
  await expect('GET /partner/bookings/status-counts', 'GET', '/partner/bookings/status-counts', {
    token: P,
  });
  await expect('GET /partner/notifications', 'GET', '/partner/notifications', { token: P });

  const propA = partnerProps?.[0];
  const roomA = propA?.rooms?.[0];

  // Tenant isolation: partner B must not see partner A's property, and must get
  // a 404 rather than a 403 — a 403 would confirm the id exists.
  if (propA) {
    await expect(
      "partner B cannot read partner A's property",
      'GET',
      `/partner/properties/${propA.id}`,
      { token: partnerB.accessToken, status: 404 },
    );
    await expect(
      "partner B cannot edit partner A's property",
      'PATCH',
      `/partner/properties/${propA.id}`,
      { token: partnerB.accessToken, status: 404, body: { name: 'Hijacked' } },
    );
  }
  if (roomA) {
    await expect(
      "partner B cannot read partner A's room calendar",
      'GET',
      `/partner/rooms/${roomA.id}/availability?from=${day(1)}&to=${day(8)}`,
      { token: partnerB.accessToken, status: 404 },
    );
  }

  // ── partner calendar ──────────────────────────────────────────────────────
  console.log('\npartner calendar');
  if (roomA) {
    const calendar = await expect(
      'GET /partner/rooms/:id/availability',
      'GET',
      `/partner/rooms/${roomA.id}/availability?from=${day(20)}&to=${day(27)}`,
      {
        token: P,
        check: (b) => (b?.days?.length === 7 ? null : `expected 7 days, got ${b?.days?.length}`),
      },
    );
    await expect(
      'PATCH /partner/rooms/:id/availability sets a price',
      'PATCH',
      `/partner/rooms/${roomA.id}/availability`,
      {
        token: P,
        body: { from: day(20), to: day(23), price: 777_000 },
        check: (b) => (b?.updated === 3 ? null : `updated ${b?.updated}, expected 3`),
      },
    );
    const repriced = await call('GET', `/partner/rooms/${roomA.id}/availability?from=${day(20)}&to=${day(23)}`, {
      token: P,
    });
    const allPriced = repriced.body?.days?.every((d) => d.price === 777_000);
    if (allPriced) ok('the new price is what the calendar reads back');
    else bad('the new price is what the calendar reads back', JSON.stringify(repriced.body?.days));

    await expect(
      'PATCH availability rejects a reversed range',
      'PATCH',
      `/partner/rooms/${roomA.id}/availability`,
      { token: P, status: 400, body: { from: day(23), to: day(20), price: 500_000 } },
    );
    if (calendar) ok('calendar fills gaps with the base price');
  }

  // ── customer catalogue (public) ───────────────────────────────────────────
  console.log('\ncustomer catalogue');
  await expect('GET /properties (no token needed)', 'GET', '/properties?limit=5');
  await expect('GET /properties/provinces', 'GET', '/properties/provinces');

  const dated = await expect(
    'GET /properties filtered by a date range',
    'GET',
    `/properties?checkIn=${day(30)}&checkOut=${day(33)}&guests=2&limit=50`,
    { check: (b) => (b?.items?.length ? null : 'no available properties for the range') },
  );

  // Book at partner A's own property on purpose: the chat checks further down
  // assert who can and cannot see the conversation, and that only means
  // anything if we know which partner owns the booking.
  const listing =
    dated?.items?.find((i) => String(i.id) === String(propA?.id)) ?? dated?.items?.[0];
  if (propA && listing && String(listing.id) !== String(propA.id)) {
    bad("partner A's property is bookable", 'it was not in the dated search results');
  }

  if (listing) {
    await expect(
      'a dated search prices the whole stay',
      'GET',
      `/properties?checkIn=${day(30)}&checkOut=${day(33)}&guests=2&limit=1`,
      {
        check: (b) => {
          const item = b?.items?.[0];
          if (!item) return 'no item';
          if (item.nights !== 3) return `nights is ${item.nights}, expected 3`;
          return item.staySubtotal > item.fromPricePerNight ? null : 'stay subtotal is not 3 nights';
        },
      },
    );

    const detail = await expect('GET /properties/:id', 'GET', `/properties/${listing.id}?checkIn=${day(30)}&checkOut=${day(33)}`, {
      check: (b) => (b?.rooms?.length ? null : 'property has no rooms'),
    });
    await expect(
      'GET /properties/:id/calendar',
      'GET',
      `/properties/${listing.id}/calendar?from=${day(30)}&to=${day(33)}`,
      { check: (b) => (b?.rooms?.length ? null : 'no room calendars') },
    );
    await expect('GET /properties/:id 404s for an unknown id', 'GET', '/properties/99999999', {
      status: 404,
    });

    var bookableRoom = detail?.rooms?.find((r) => r.available);
    if (!bookableRoom) bad('the property detail marks a room available', 'none were available');
    else ok('the property detail marks a room available');
  }

  await expect('POST /promos/validate accepts a live code', 'POST', '/promos/validate', {
    body: { code: 'WEEKEND15', subtotal: 1_000_000 },
    check: (b) => (b?.discount === 150_000 ? null : `discount is ${b?.discount}, expected 150000`),
  });
  await expect('POST /promos/validate rejects an expired code', 'POST', '/promos/validate', {
    body: { code: 'NEWYEAR50' },
    status: 400,
  });
  await expect('POST /promos/validate 404s for an unknown code', 'POST', '/promos/validate', {
    body: { code: 'NOSUCHCODE' },
    status: 404,
  });

  // ── customer booking, payment and review ──────────────────────────────────
  console.log('\ncustomer booking');
  const customer = await loginAs('customer', 'souda.v@gmail.com', CUSTOMER_PASSWORD);
  ok('POST /auth/customer/login');
  const C = customer.accessToken;

  await expect('GET /auth/customer/me', 'GET', '/auth/customer/me', { token: C });
  await expect('a suspended customer cannot log in', 'POST', '/auth/customer/login', {
    body: { email: 'vilay.p@gmail.com', password: CUSTOMER_PASSWORD },
    // The account authenticates, then the strategy refuses it on first use.
    check: (b) => (b?.accessToken ? null : 'expected the login itself to succeed'),
  });
  const suspended = await call('POST', '/auth/customer/login', {
    body: { email: 'vilay.p@gmail.com', password: CUSTOMER_PASSWORD },
  });
  await expect('a suspended customer is refused on an authenticated route', 'GET', '/customer/me', {
    token: suspended.body?.accessToken,
    status: 403,
  });

  await expect('GET /customer/me', 'GET', '/customer/me', {
    token: C,
    check: (b) => (b?.email === 'souda.v@gmail.com' ? null : `unexpected email ${b?.email}`),
  });
  await expect('a customer token is refused on a partner route', 'GET', '/partner/properties', {
    token: C,
    status: 401,
  });

  let booking = null;
  if (typeof bookableRoom !== 'undefined' && bookableRoom) {
    const stay = { roomId: String(bookableRoom.id), checkIn: day(30), checkOut: day(33), guests: 2 };

    const quote = await expect('POST /customer/bookings/quote', 'POST', '/customer/bookings/quote', {
      token: C,
      body: stay,
      check: (b) =>
        b?.subtotal + b?.fee - b?.discount === b?.total
          ? null
          : `subtotal ${b?.subtotal} + fee ${b?.fee} - discount ${b?.discount} !== total ${b?.total}`,
    });

    await expect('a quote with a promo code discounts the total', 'POST', '/customer/bookings/quote', {
      token: C,
      body: { ...stay, promoCode: 'WEEKEND15' },
      check: (b) => (b?.discount > 0 && b?.total < quote?.total ? null : 'the promo changed nothing'),
    });

    await expect('a booking is refused when check-out precedes check-in', 'POST', '/customer/bookings', {
      token: C,
      status: 400,
      body: { ...stay, checkIn: day(33), checkOut: day(30) },
    });
    await expect('a booking is refused for more guests than the room holds', 'POST', '/customer/bookings', {
      token: C,
      status: 400,
      body: { ...stay, guests: 20 },
    });

    booking = await expect('POST /customer/bookings', 'POST', '/customer/bookings', {
      token: C,
      status: 201,
      body: stay,
      check: (b) => {
        if (b?.status !== 'pending') return `status is ${b?.status}, expected pending`;
        if (b?.subtotal + b?.fee - b?.discount !== b?.total) return 'the stored totals do not balance';
        return null;
      },
    });

    await expect('GET /customer/bookings lists it', 'GET', '/customer/bookings?limit=50', {
      token: C,
      check: (b) => (b?.items?.some((i) => String(i.id) === String(booking?.id)) ? null : 'the new booking is missing'),
    });
    await expect('the newest booking sorts first', 'GET', '/customer/bookings?limit=1', {
      token: C,
      check: (b) =>
        String(b?.items?.[0]?.id) === String(booking?.id)
          ? null
          : `first item is ${b?.items?.[0]?.id}, expected ${booking?.id}`,
    });
  }

  // ── payment ───────────────────────────────────────────────────────────────
  console.log('\npayment');
  if (booking) {
    const payment = await expect('POST /customer/bookings/:id/pay issues a QR', 'POST', `/customer/bookings/${booking.id}/pay`, {
      token: C,
      status: 201,
      check: (b) => {
        if (!b?.qrPayload?.startsWith('000201')) return 'the QR payload is not EMVCo';
        if (b?.amount !== booking.total) return `QR is for ${b?.amount}, booking is ${booking.total}`;
        return null;
      },
    });

    const second = await call('POST', `/customer/bookings/${booking.id}/pay`, { token: C });
    if (String(second.body?.id) === String(payment?.id)) {
      ok('paying twice reuses the same QR', `payment ${payment?.id}`);
    } else {
      bad('paying twice reuses the same QR', `got ${second.body?.id}, first was ${payment?.id}`);
    }

    await expect('an unsigned webhook is rejected', 'POST', '/payments/phajay/webhook', {
      status: 401,
      body: { reference: 'STL-0001', txnRef: 'forged', amount: 1, status: 'paid' },
    });

    if (payment) {
      await expect('POST /payments/dev/settle/:id settles it', 'POST', `/payments/dev/settle/${payment.id}`, {
        check: (b) => (b?.paid === true ? null : `settle returned ${JSON.stringify(b)}`),
      });
      await expect('settling twice is a no-op', 'POST', `/payments/dev/settle/${payment.id}`, {
        check: (b) => (b?.duplicate === true ? null : `expected duplicate, got ${JSON.stringify(b)}`),
      });
      await expect('the booking is confirmed after payment', 'GET', `/customer/bookings/${booking.id}`, {
        token: C,
        check: (b) => (b?.status === 'confirmed' ? null : `status is ${b?.status}`),
      });
      await expect('GET /customer/payments/:id', 'GET', `/customer/payments/${payment.id}`, {
        token: C,
        check: (b) => (b?.status === 'paid' ? null : `payment status is ${b?.status}`),
      });
      await expect('another customer cannot read that payment', 'GET', `/customer/payments/${payment.id}`, {
        token: (await loginAs('customer', 'mali.x@gmail.com', CUSTOMER_PASSWORD)).accessToken,
        status: 404,
      });
    }
  }

  // ── double booking ────────────────────────────────────────────────────────
  console.log('\ndouble booking');
  if (booking) {
    // The seeded rooms have qty > 1, so filling the night takes as many
    // bookings as there are copies. Keep going until one is refused.
    let refusedAt = null;
    for (let i = 0; i < 12 && refusedAt === null; i++) {
      const res = await call('POST', '/customer/bookings', {
        token: C,
        body: {
          roomId: String(booking.room_id ?? booking.roomId ?? bookableRoom.id),
          checkIn: day(30),
          checkOut: day(33),
          guests: 2,
        },
      });
      if (res.status === 409) refusedAt = i;
      else if (res.status !== 201) {
        bad('a room stops taking bookings once its copies are gone', `unexpected ${res.status} ${JSON.stringify(res.body)?.slice(0, 120)}`);
        refusedAt = -1;
      }
    }
    if (refusedAt !== null && refusedAt >= 0) {
      ok('a room stops taking bookings once its copies are gone', `refused after ${refusedAt + 1} more`);
    } else if (refusedAt === null) {
      bad('a room stops taking bookings once its copies are gone', 'still accepting after 12 attempts');
    }
  }

  // ── partner walk-in ───────────────────────────────────────────────────────
  console.log('\npartner walk-in');
  if (roomA) {
    const walkIn = await expect('POST /partner/bookings/walk-in', 'POST', '/partner/bookings/walk-in', {
      token: P,
      status: 201,
      body: {
        roomId: String(roomA.id),
        checkIn: day(45),
        checkOut: day(47),
        guests: 1,
        guestName: 'ທ້າວ ຍ່າງເຂົ້າມາ',
        guestPhone: '+856 20 8888 9999',
      },
      check: (b) => {
        if (b?.source !== 'walk_in') return `source is ${b?.source}`;
        if (b?.status !== 'confirmed') return `status is ${b?.status}`;
        // A walk-in pays the room rate at the desk: no platform service fee.
        if (b?.fee !== 0) return `fee is ${b?.fee}, expected 0 for a walk-in`;
        return null;
      },
    });

    if (walkIn) {
      await expect('a walk-in appears in the partner booking list', 'GET', `/partner/bookings/${walkIn.id}`, {
        token: P,
        check: (b) => (b?.source === 'walk_in' ? null : `source is ${b?.source}`),
      });
      await expect('partner B cannot read that booking', 'GET', `/partner/bookings/${walkIn.id}`, {
        token: partnerB.accessToken,
        status: 404,
      });
      await expect('PATCH /partner/bookings/:id/status → staying', 'PATCH', `/partner/bookings/${walkIn.id}/status`, {
        token: P,
        body: { status: 'staying' },
      });
      await expect('the status ladder refuses a backwards move', 'PATCH', `/partner/bookings/${walkIn.id}/status`, {
        token: P,
        status: 400,
        body: { status: 'confirmed' },
      });
      await expect('PATCH /partner/bookings/:id/status → done', 'PATCH', `/partner/bookings/${walkIn.id}/status`, {
        token: P,
        body: { status: 'done' },
      });
    }
  }

  // ── chat ──────────────────────────────────────────────────────────────────
  console.log('\nchat');
  if (booking) {
    const sent = await expect('POST /customer/chat/bookings/:id/messages', 'POST', `/customer/chat/bookings/${booking.id}/messages`, {
      token: C,
      status: 201,
      body: { body: 'ສະບາຍດີ ຂໍຖາມກ່ຽວກັບເວລາເຊັກອິນ' },
      check: (b) => (b?.senderType === 'user' ? null : `senderType is ${b?.senderType}`),
    });

    await expect('the partner sees it', 'GET', `/partner/chat/bookings/${booking.id}/messages`, {
      token: P,
      check: (b) => (b?.messages?.length ? null : 'the partner sees no messages'),
    });
    await expect('the partner replies', 'POST', `/partner/chat/bookings/${booking.id}/messages`, {
      token: P,
      status: 201,
      body: { body: 'ເຊັກອິນໄດ້ຕັ້ງແຕ່ 14:00 ຄັບ' },
      check: (b) => (b?.senderType === 'partner' ? null : `senderType is ${b?.senderType}`),
    });

    if (sent) {
      await expect('the `since` cursor returns only newer messages', 'GET', `/customer/chat/bookings/${booking.id}/messages?since=${sent.id}`, {
        token: C,
        check: (b) => {
          const stale = b?.messages?.filter((m) => BigInt(m.id) <= BigInt(sent.id));
          return stale?.length ? `${stale.length} message(s) at or before the cursor` : null;
        },
      });
    }

    await expect('the guest has an unread reply', 'GET', '/customer/chat/unread', {
      token: C,
      check: (b) => (b?.total >= 1 ? null : `unread total is ${b?.total}`),
    });
    await expect('PATCH marks the conversation read', 'PATCH', `/customer/chat/bookings/${booking.id}/read`, {
      token: C,
      check: (b) => (b?.read >= 1 ? null : `marked ${b?.read} read`),
    });
    await expect('an outsider cannot read the conversation', 'GET', `/partner/chat/bookings/${booking.id}/messages`, {
      token: partnerB.accessToken,
      status: 404,
    });
    await expect('an admin can read any conversation', 'GET', `/admin/chat/bookings/${booking.id}/messages`, {
      token: A,
      check: (b) => (b?.messages?.length ? null : 'the admin sees no messages'),
    });
  }

  // ── photo upload ──────────────────────────────────────────────────────────
  console.log('\nphoto upload');
  if (propA) {
    const before = (await call('GET', `/partner/properties/${propA.id}`, { token: P })).body?.photos?.length ?? 0;

    const uploaded = await expectUpload('POST /partner/properties/:id/photos', `/partner/properties/${propA.id}/photos`, P, {
      check: (b) => (b?.photos?.length === before + 1 ? null : `photos went ${before} → ${b?.photos?.length}`),
    });

    await expectUpload('a non-image is refused', `/partner/properties/${propA.id}/photos`, P, {
      status: 415,
      filename: 'evil.png',
      type: 'image/png',
      bytes: Buffer.from('#!/bin/sh\necho not a png\n', 'utf8'),
    });
    await expectUpload('an unsupported type is refused', `/partner/properties/${propA.id}/photos`, P, {
      status: 415,
      filename: 'doc.pdf',
      type: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4', 'utf8'),
    });
    await expectUpload("partner B cannot upload to partner A's property", `/partner/properties/${propA.id}/photos`, partnerB.accessToken, {
      status: 404,
    });

    if (uploaded) {
      const url = uploaded.photos[uploaded.photos.length - 1].url;
      const served = await fetch(BASE.replace(/\/api$/, '') + url);
      if (served.ok) ok('the uploaded photo is served', url);
      else bad('the uploaded photo is served', `GET ${url} returned ${served.status}`);

      await expect(
        'DELETE /partner/properties/:id/photos/:index',
        'DELETE',
        `/partner/properties/${propA.id}/photos/${uploaded.photos.length - 1}`,
        { token: P, check: (b) => (b?.photos?.length === before ? null : `photos left at ${b?.photos?.length}`) },
      );
    }
  }

  // ── customer review and cancellation ──────────────────────────────────────
  console.log('\nreview and cancellation');
  if (booking) {
    await expect('a review is refused before the stay is done', 'POST', `/customer/bookings/${booking.id}/review`, {
      token: C,
      status: 400,
      body: { stars: 5, text: 'ດີຫຼາຍ' },
    });

    const cancelled = await expect('POST /customer/bookings/:id/cancel', 'POST', `/customer/bookings/${booking.id}/cancel`, {
      token: C,
      body: { reason: 'ປ່ຽນແຜນ' },
      check: (b) => {
        if (b?.booking?.status !== 'cancelled') return `status is ${b?.booking?.status}`;
        if (b?.fee + b?.refund !== b?.paid) return `fee ${b?.fee} + refund ${b?.refund} !== paid ${b?.paid}`;
        return null;
      },
    });
    if (cancelled) ok('cancellation maths: fee + refund === amount paid');

    await expect('cancelling twice is rejected', 'POST', `/customer/bookings/${booking.id}/cancel`, {
      token: C,
      status: 400,
      body: {},
    });
  }

  // A completed stay is what a review needs, so use one the seed already made.
  const doneStays = await call('GET', '/customer/bookings?status=done&limit=5', { token: C });
  const reviewable = doneStays.body?.items?.find((b) => !b.reviewed);
  if (reviewable) {
    await expect('POST /customer/bookings/:id/review', 'POST', `/customer/bookings/${reviewable.id}/review`, {
      token: C,
      status: 201,
      body: { stars: 5, text: 'ທີ່ພັກສະອາດ ພະນັກງານໃຈດີ' },
      check: (b) => (b?.review?.stars === 5 ? null : `stars is ${b?.review?.stars}`),
    });
    await expect('reviewing the same stay twice is rejected', 'POST', `/customer/bookings/${reviewable.id}/review`, {
      token: C,
      status: 409,
      body: { stars: 4 },
    });
  }

  // ── wishlist ──────────────────────────────────────────────────────────────
  console.log('\nwishlist');
  if (listing) {
    await call('DELETE', `/customer/wishlist/${listing.id}`, { token: C });
    await expect('POST /customer/wishlist/:id', 'POST', `/customer/wishlist/${listing.id}`, {
      token: C,
      status: 201,
    });
    await expect('POST /customer/wishlist/:id twice is rejected', 'POST', `/customer/wishlist/${listing.id}`, {
      token: C,
      status: 409,
    });
    await expect('GET /customer/wishlist', 'GET', '/customer/wishlist', {
      token: C,
      check: (b) => (b?.some((w) => String(w.propertyId) === String(listing.id)) ? null : 'the property is not in the wishlist'),
    });
    await expect('DELETE /customer/wishlist/:id', 'DELETE', `/customer/wishlist/${listing.id}`, {
      token: C,
      check: (b) => (b?.removed === 1 ? null : `removed ${b?.removed}`),
    });
  }

  // ── notifications ─────────────────────────────────────────────────────────
  console.log('\nnotifications');
  await expect('GET /customer/notifications', 'GET', '/customer/notifications', {
    token: C,
    check: (b) => (Array.isArray(b?.items) ? null : 'no items array'),
  });
  await expect('POST /partner/notifications/read-all', 'POST', '/partner/notifications/read-all', {
    token: P,
    check: (b) => (typeof b?.updated === 'number' ? null : 'no updated count'),
  });
  await expect('GET /partner/notifications?unreadOnly=true is then empty', 'GET', '/partner/notifications?unreadOnly=true', {
    token: P,
    check: (b) => (b?.unread === 0 ? null : `${b?.unread} still unread`),
  });

  console.log('\n' + '─'.repeat(64));
  console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('');
    for (const f of failures) console.log(`  · ${f}`);
  }
  console.log('─'.repeat(64) + '\n');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('\nSmoke run crashed:', e.message);
  process.exit(1);
});

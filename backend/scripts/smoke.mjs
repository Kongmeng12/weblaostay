/**
 * End-to-end smoke test against a running API.
 *
 *   npm run start:dev      (in one terminal)
 *   npm run smoke          (in another)
 *
 * Logs in as each seeded role, exercises every admin endpoint, and asserts the
 * RBAC boundary actually holds — a staff account must be refused at the payout
 * endpoints, not merely hidden from them in the UI.
 */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3100/api';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'LaoStay@2026';

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

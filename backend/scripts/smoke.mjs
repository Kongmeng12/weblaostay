/**
 * End-to-end smoke test against a running v2 API.
 *
 *   npm run db:reset       (rebuilds the schema and reseeds)
 *   npm run start:dev      (in one terminal)
 *   npm run smoke          (in another)
 *
 * Exercises the whole booking loop and, more importantly, asserts the
 * boundaries hold: inventory cannot be oversold, a hold that expires comes
 * back, one partner cannot see another's rows, and staff cannot move money.
 */
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3100/api';
const ADMIN_PW = 'LaoStay@2026';
const PARTNER_PW = 'Partner@2026';
const CUSTOMER_PW = 'Customer@2026';

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

async function call(method, p, { token, body, form } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(form ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(form ? { body: form } : body ? { body: JSON.stringify(body) } : {}),
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
async function expect(name, method, p, opts = {}) {
  const { token, body, form, status = 200, check } = opts;
  const res = await call(method, p, { token, body, form });
  if (res.status !== status) {
    bad(name, `expected ${status}, got ${res.status} ${JSON.stringify(res.body)?.slice(0, 160)}`);
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

async function login(email, password) {
  const res = await call('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
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

function imageForm(bytes = PNG_1PX, type = 'image/png', filename = 'photo.png') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);
  return form;
}

// ── direct database access, for the invariants an API cannot show ───────────

const here = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(here, '..', '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

let db;
async function sql(query, params = []) {
  const { rows } = await db.query(query, params);
  return rows;
}

async function main() {
  console.log(`\nSmoke test → ${BASE}\n`);
  db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();

  // ── health ────────────────────────────────────────────────────────────────
  console.log('health');
  await expect('GET /health', 'GET', '/health', {
    check: (b) => (b?.database === 'connected' ? null : 'database not connected'),
  });

  // ── auth ──────────────────────────────────────────────────────────────────
  console.log('\nauth');

  // The seed writes bcrypt (pgcrypto has no argon2). Signing in must accept it
  // and then replace it — otherwise every seeded account is stuck on the weaker
  // hash forever.
  const [before] = await sql(
    `SELECT left(password_hash, 8) AS algo FROM users WHERE email = 'souda.v@gmail.com'`,
  );
  const customer = await login('souda.v@gmail.com', CUSTOMER_PW);
  ok('POST /auth/login with a bcrypt seed password', `was ${before.algo}`);

  await new Promise((r) => setTimeout(r, 800)); // the rehash is fire-and-forget
  const [after] = await sql(
    `SELECT left(password_hash, 8) AS algo FROM users WHERE email = 'souda.v@gmail.com'`,
  );
  if (after.algo.startsWith('$argon2')) ok('the hash was upgraded to argon2 on sign-in');
  else bad('the hash was upgraded to argon2 on sign-in', `still ${after.algo}`);

  const C = customer.accessToken;
  const admin = await login('amnuay@laostay.la', ADMIN_PW);
  const finance = await login('bounmy@laostay.la', ADMIN_PW);
  const staff = await login('phonsy@laostay.la', ADMIN_PW);
  ok('POST /auth/login for all three admin roles');
  const A = admin.accessToken;

  const partnerA = await login('vintage@laostay.la', PARTNER_PW);
  const partnerB = await login('homsabay@laostay.la', PARTNER_PW);
  ok('POST /auth/login for two partners');
  const P = partnerA.accessToken;

  await expect('GET /auth/me', 'GET', '/auth/me', {
    token: C,
    check: (b) => (b?.role === 'CUSTOMER' ? null : `role is ${b?.role}`),
  });
  await expect('an unauthenticated request is refused', 'GET', '/customer/bookings', {
    status: 401,
  });
  await expect('a customer token is refused on a partner route', 'GET', '/partner/properties', {
    token: C,
    status: 403,
  });
  await expect('a partner token is refused on an admin route', 'GET', '/admin/dashboard', {
    token: P,
    status: 403,
  });

  const refreshed = await expect('POST /auth/refresh rotates the token', 'POST', '/auth/refresh', {
    body: { refreshToken: customer.refreshToken },
    check: (b) => (b?.accessToken ? null : 'no accessToken returned'),
  });
  if (refreshed) {
    await expect('POST /auth/refresh rejects a reused token', 'POST', '/auth/refresh', {
      body: { refreshToken: customer.refreshToken },
      status: 401,
    });
  }
  // Reuse detection revoked every session for that user, so continue fresh.
  const CFRESH = (await login('souda.v@gmail.com', CUSTOMER_PW)).accessToken;

  // ── brute-force lockout ───────────────────────────────────────────────────
  console.log('\nlogin guard');
  const victim = 'lin.zhao@qq.com';
  await sql(`DELETE FROM login_attempts WHERE identifier = $1`, [victim]);
  let locked = false;
  for (let i = 0; i < 8; i++) {
    const res = await call('POST', '/auth/login', {
      body: { email: victim, password: 'wrong-on-purpose' },
    });
    if (res.status === 429) {
      locked = true;
      break;
    }
  }
  if (locked) ok('repeated wrong passwords lock the account out (429)');
  else bad('repeated wrong passwords lock the account out (429)', 'never got a 429');
  await sql(`DELETE FROM login_attempts WHERE identifier = $1`, [victim]);

  // ── OTP and password reset ────────────────────────────────────────────────
  console.log('\notp & password reset');
  const otp = await expect('POST /auth/otp/request', 'POST', '/auth/otp/request', {
    body: { target: '+856 20 5789 1234', purpose: 'verify' },
    check: (b) => (b?.devCode ? null : 'no devCode returned outside production'),
  });
  if (otp) {
    await expect('POST /auth/otp/verify rejects a wrong code', 'POST', '/auth/otp/verify', {
      status: 400,
      body: { target: '+856 20 5789 1234', purpose: 'verify', code: '000000' },
    });
    await expect('POST /auth/otp/verify accepts the right code', 'POST', '/auth/otp/verify', {
      body: { target: '+856 20 5789 1234', purpose: 'verify', code: otp.devCode },
      check: (b) => (b?.verified ? null : 'not verified'),
    });
  }
  await expect(
    'POST /auth/password/forgot is silent about unknown emails',
    'POST',
    '/auth/password/forgot',
    { body: { email: 'nobody@nowhere.la' }, check: (b) => (b?.sent ? null : 'did not report sent') },
  );

  // ── catalogue ─────────────────────────────────────────────────────────────
  console.log('\ncatalogue');
  await expect('GET /properties (no token needed)', 'GET', '/properties?limit=5');
  await expect('GET /locations/provinces', 'GET', '/locations/provinces', {
    check: (b) => (b?.length === 18 ? null : `expected 18 provinces, got ${b?.length}`),
  });
  await expect('GET /amenities', 'GET', '/amenities', {
    check: (b) => (b?.length >= 20 ? null : `only ${b?.length} amenities`),
  });
  await expect('full-text search finds Mekong View', 'GET', '/properties?q=mekong', {
    check: (b) =>
      b?.items?.some((i) => i.name.includes('Mekong')) ? null : 'no match for "mekong"',
  });
  await expect('geo search returns a distance and sorts by it', 'GET',
    '/properties?lat=17.9668&lng=102.61&radiusKm=300&sort=distance', {
      check: (b) => {
        const d = b?.items?.map((i) => i.distanceKm);
        if (!d?.length) return 'no results';
        if (d.some((x) => x === null)) return 'a distance came back null';
        return d.every((x, i) => i === 0 || x >= d[i - 1]) ? null : `not sorted: ${d.join(',')}`;
      },
    });

  const dated = await expect(
    'a dated search only returns properties that can take the booking',
    'GET',
    `/properties?checkIn=${day(30)}&checkOut=${day(33)}&guests=2&limit=50`,
    {
      check: (b) => {
        if (!b?.items?.length) return 'no available properties';
        const bad = b.items.find((i) => i.nights !== 3 || !(i.staySubtotal > 0));
        return bad ? `bad pricing on ${bad.name}` : null;
      },
    },
  );

  const listing = dated?.items?.[0];
  let roomTypeId = null;
  if (listing) {
    const detail = await expect('GET /properties/:id', 'GET',
      `/properties/${listing.id}?checkIn=${day(30)}&checkOut=${day(33)}`, {
        check: (b) => (b?.roomTypes?.length ? null : 'no room types'),
      });
    await expect('GET /properties/:id/calendar', 'GET',
      `/properties/${listing.id}/calendar?from=${day(30)}&to=${day(33)}`, {
        check: (b) => {
          const rt = b?.roomTypes?.[0];
          return rt?.days?.length === 3 ? null : `expected 3 nights, got ${rt?.days?.length}`;
        },
      });
    roomTypeId = detail?.roomTypes?.find((r) => r.available)?.id ?? null;
    if (roomTypeId) ok('the property page marks a room type available');
    else bad('the property page marks a room type available', 'none were');
  }
  await expect('GET /properties/:id 404s for an unknown id', 'GET', '/properties/99999999', {
    status: 404,
  });

  // ── booking with an inventory hold ────────────────────────────────────────
  console.log('\nbooking & hold');
  let booking = null;
  if (roomTypeId) {
    const stay = { roomTypeId, checkIn: day(30), checkOut: day(33), guests: 2 };

    await expect('POST /customer/bookings/quote', 'POST', '/customer/bookings/quote', {
      token: CFRESH,
      body: stay,
      check: (b) =>
        b.subtotal + b.serviceFee + b.tax + b.cleaningFee - b.discount === b.total
          ? null
          : `subtotal ${b.subtotal} + fee ${b.serviceFee} + tax ${b.tax} !== total ${b.total}`,
    });

    await expect('a booking is refused when check-out precedes check-in', 'POST',
      '/customer/bookings', {
        token: CFRESH, status: 400,
        body: { ...stay, checkIn: day(33), checkOut: day(30) },
      });
    await expect('a booking is refused for more guests than the room holds', 'POST',
      '/customer/bookings', { token: CFRESH, status: 400, body: { ...stay, guests: 25 } });

    const [beforeInv] = await sql(
      `SELECT held_count, booked_count FROM room_inventory
        WHERE room_type_id = $1 AND date = $2`,
      [roomTypeId, day(30)],
    );

    const idem = `smoke-${Date.now()}`;
    booking = await expect('POST /customer/bookings', 'POST', '/customer/bookings', {
      token: CFRESH,
      status: 201,
      body: { ...stay, idempotencyKey: idem },
      check: (b) => (b?.status === 'pending' ? null : `status is ${b?.status}`),
    });

    const [afterInv] = await sql(
      `SELECT held_count, booked_count FROM room_inventory
        WHERE room_type_id = $1 AND date = $2`,
      [roomTypeId, day(30)],
    );
    if (Number(afterInv.held_count) === Number(beforeInv.held_count) + 1) {
      ok('booking takes a hold', `held ${beforeInv.held_count} → ${afterInv.held_count}`);
    } else {
      bad('booking takes a hold', `held ${beforeInv.held_count} → ${afterInv.held_count}`);
    }

    if (booking) {
      // A retried request — a flaky connection, a double tap — must return the
      // booking that already exists, not hold a second room.
      await expect('the same idempotency key returns the same booking', 'POST',
        '/customer/bookings', {
          token: CFRESH,
          status: 201,
          body: { ...stay, idempotencyKey: idem },
          check: (b) => (String(b?.id) === String(booking.id) ? null : `got ${b?.id}, first was ${booking.id}`),
        });

      const [replayed] = await sql(
        `SELECT held_count FROM room_inventory WHERE room_type_id = $1 AND date = $2`,
        [roomTypeId, day(30)],
      );
      if (Number(replayed.held_count) === Number(afterInv.held_count)) {
        ok('the replay did not take a second hold');
      } else {
        bad('the replay did not take a second hold',
          `held ${afterInv.held_count} → ${replayed.held_count}`);
      }
    }
  }

  // ── overbooking ───────────────────────────────────────────────────────────
  //
  // The point of the exercise. Sequential bookings would pass even with no
  // locking at all — it is simultaneous requests that catch a read-then-write
  // race, so these all go out at once and the count of successes has to land
  // exactly on the capacity that was free beforehand.
  console.log('\noverbooking');
  if (roomTypeId) {
    // Capacity for a stay is the tightest night in it, and every night has to
    // be open — one closed night makes the whole range unbookable.
    const [{ capacity, open_nights }] = await sql(
      `SELECT min(available_count)::int AS capacity, count(*)::int AS open_nights
         FROM room_inventory
        WHERE room_type_id = $1 AND date >= $2 AND date < $3 AND status = 'open'`,
      [roomTypeId, day(30), day(33)],
    );
    if (open_nights !== 3) {
      bad('the three nights under test are all open', `only ${open_nights} are`);
    }

    const attempts = capacity + 4;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        call('POST', '/customer/bookings', {
          token: CFRESH,
          body: { roomTypeId, checkIn: day(30), checkOut: day(33), guests: 1 },
        }),
      ),
    );

    const created = results.filter((r) => r.status === 201).length;
    const refused = results.filter((r) => r.status === 409).length;
    const other = results.filter((r) => r.status !== 201 && r.status !== 409);

    if (other.length) {
      bad('concurrent bookings return only 201 or 409',
        other.map((r) => `${r.status} ${JSON.stringify(r.body)?.slice(0, 80)}`).join(' | '));
    } else {
      ok('concurrent bookings return only 201 or 409', `${created} created, ${refused} refused`);
    }

    if (created === capacity) {
      ok('exactly the free rooms were sold', `capacity ${capacity}, sold ${created}`);
    } else {
      bad('exactly the free rooms were sold', `capacity ${capacity} but ${created} succeeded`);
    }
    if (refused > 0) ok('the requests past capacity got 409', `${refused} of ${attempts}`);
    else bad('the requests past capacity got 409', 'nothing was refused');

    const [over] = await sql(
      `SELECT count(*)::int n FROM room_inventory WHERE held_count + booked_count > total_count`,
    );
    if (over.n === 0) ok('held + booked never exceeded total');
    else bad('held + booked never exceeded total', `${over.n} oversold night(s)`);
  }

  // ── the sweeper ───────────────────────────────────────────────────────────
  console.log('\nhold sweeper');
  if (booking) {
    // Backdate the hold and wait for the minute-ly sweep to reclaim it.
    await sql(`UPDATE bookings SET hold_expires_at = now() - interval '1 hour'
                WHERE booking_id = $1 AND status = 'pending'`, [booking.id]);
    const [heldBefore] = await sql(
      `SELECT held_count FROM room_inventory WHERE room_type_id = $1 AND date = $2`,
      [roomTypeId, day(30)],
    );

    process.stdout.write('  ...waiting up to 70s for the sweeper\n');
    let swept = false;
    for (let i = 0; i < 35 && !swept; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const [row] = await sql(`SELECT status FROM bookings WHERE booking_id = $1`, [booking.id]);
      if (row.status === 'cancelled') swept = true;
    }

    if (swept) {
      const [heldAfter] = await sql(
        `SELECT held_count FROM room_inventory WHERE room_type_id = $1 AND date = $2`,
        [roomTypeId, day(30)],
      );
      ok('an expired hold is cancelled and the room released',
        `held ${heldBefore.held_count} → ${heldAfter.held_count}`);
      if (Number(heldAfter.held_count) < Number(heldBefore.held_count)) {
        ok('the released night went back on sale');
      } else {
        bad('the released night went back on sale', 'held_count did not fall');
      }
    } else {
      bad('an expired hold is cancelled and the room released', 'still pending after 70s');
    }
  }

  // ── payment ───────────────────────────────────────────────────────────────
  console.log('\npayment');
  let paidBooking = null;
  if (roomTypeId) {
    const created = await call('POST', '/customer/bookings', {
      token: CFRESH,
      body: { roomTypeId, checkIn: day(45), checkOut: day(47), guests: 1 },
    });
    if (created.status !== 201) {
      bad('a booking to pay for', `create returned ${created.status} ${JSON.stringify(created.body)}`);
    }
    paidBooking = created.status === 201 ? created.body : null;
  }
  if (paidBooking) {
    const payment = await expect('POST /customer/bookings/:id/pay issues a QR', 'POST',
      `/customer/bookings/${paidBooking.id}/pay`, {
        token: CFRESH, status: 201,
        check: (b) => {
          if (!b?.qrPayload?.startsWith('000201')) return 'the QR payload is not EMVCo';
          if (b.amount !== paidBooking.total) return `QR is ${b.amount}, booking is ${paidBooking.total}`;
          return null;
        },
      });

    const second = await call('POST', `/customer/bookings/${paidBooking.id}/pay`, { token: CFRESH });
    if (String(second.body?.id) === String(payment?.id)) ok('paying twice reuses the same QR');
    else bad('paying twice reuses the same QR', `got ${second.body?.id}, first ${payment?.id}`);

    await expect('an unsigned webhook is rejected', 'POST', '/payments/phajay/webhook', {
      status: 401,
      body: { reference: 'STL-0001', txnRef: 'forged', amount: 1, status: 'paid' },
    });

    if (payment) {
      const [beforeSettle] = await sql(
        `SELECT held_count, booked_count FROM room_inventory
          WHERE room_type_id = $1 AND date = $2`, [roomTypeId, day(45)],
      );

      await expect('POST /payments/dev/settle/:id settles it', 'POST',
        `/payments/dev/settle/${payment.id}`, {
          check: (b) => (b?.paid === true ? null : `settle returned ${JSON.stringify(b)}`),
        });
      await expect('settling twice is a no-op', 'POST', `/payments/dev/settle/${payment.id}`, {
        check: (b) => (b?.duplicate === true ? null : `expected duplicate, got ${JSON.stringify(b)}`),
      });
      await expect('the booking is confirmed after payment', 'GET',
        `/customer/bookings/${paidBooking.id}`, {
          token: CFRESH,
          check: (b) => (b?.status === 'confirmed' ? null : `status is ${b?.status}`),
        });

      // The room does not leave inventory on payment, it changes column: the
      // hold becomes a booking. Anything else and the same night is either sold
      // twice or lost.
      const [afterSettle] = await sql(
        `SELECT held_count, booked_count FROM room_inventory
          WHERE room_type_id = $1 AND date = $2`, [roomTypeId, day(45)],
      );
      const heldFell = Number(afterSettle.held_count) === Number(beforeSettle.held_count) - 1;
      const bookedRose = Number(afterSettle.booked_count) === Number(beforeSettle.booked_count) + 1;
      if (heldFell && bookedRose) {
        ok('payment moved the hold into booked',
          `held ${beforeSettle.held_count}→${afterSettle.held_count}, ` +
          `booked ${beforeSettle.booked_count}→${afterSettle.booked_count}`);
      } else {
        bad('payment moved the hold into booked',
          `held ${beforeSettle.held_count}→${afterSettle.held_count}, ` +
          `booked ${beforeSettle.booked_count}→${afterSettle.booked_count}`);
      }

      const ledger = await sql(
        `SELECT entry_type, direction, amount FROM ledger_entries
          WHERE booking_id = $1 ORDER BY ledger_id`, [paidBooking.id],
      );
      const hasCharge = ledger.some((l) => l.entry_type === 'charge' && l.direction === 'credit');
      const hasCommission = ledger.some((l) => l.entry_type === 'commission' && l.direction === 'debit');
      if (hasCharge && hasCommission) ok('the ledger recorded charge and commission');
      else bad('the ledger recorded charge and commission', JSON.stringify(ledger));
    }
  }

  // ── cancellation and refund ───────────────────────────────────────────────
  console.log('\ncancellation & refund');
  if (paidBooking) {
    const [beforeCancel] = await sql(
      `SELECT held_count, booked_count FROM room_inventory
        WHERE room_type_id = $1 AND date = $2`, [roomTypeId, day(45)],
    );

    const cancelled = await expect('POST /customer/bookings/:id/cancel', 'POST',
      `/customer/bookings/${paidBooking.id}/cancel`, {
        token: CFRESH, body: { reason: 'ປ່ຽນແຜນ' },
        check: (b) => {
          if (b?.status !== 'cancelled') return `status is ${b?.status}`;
          if (b.penalty + b.refund !== b.paid) {
            return `penalty ${b.penalty} + refund ${b.refund} !== paid ${b.paid}`;
          }
          return null;
        },
      });
    if (cancelled) ok('cancellation maths: penalty + refund === amount paid');

    // A confirmed booking held `booked_count`, so that is the counter that has
    // to come back — releasing the wrong one silently loses a sellable night.
    const [afterCancel] = await sql(
      `SELECT held_count, booked_count FROM room_inventory
        WHERE room_type_id = $1 AND date = $2`, [roomTypeId, day(45)],
    );
    if (Number(afterCancel.booked_count) === Number(beforeCancel.booked_count) - 1) {
      ok('cancelling put the night back on sale',
        `booked ${beforeCancel.booked_count}→${afterCancel.booked_count}`);
    } else {
      bad('cancelling put the night back on sale',
        `booked ${beforeCancel.booked_count}→${afterCancel.booked_count}`);
    }

    await expect('cancelling twice is rejected', 'POST',
      `/customer/bookings/${paidBooking.id}/cancel`, { token: CFRESH, status: 400, body: {} });

    const refundLedger = await sql(
      `SELECT count(*)::int n FROM ledger_entries WHERE booking_id = $1 AND entry_type = 'refund'`,
      [paidBooking.id],
    );
    if (refundLedger[0].n >= 1) ok('the refund reached the ledger');
    else bad('the refund reached the ledger', 'no refund entry');
  }

  // ── partner API ───────────────────────────────────────────────────────────
  console.log('\npartner api');
  const props = await expect('GET /partner/properties', 'GET', '/partner/properties', {
    token: P, check: (b) => (b?.length ? null : 'no properties'),
  });
  await expect('GET /partner/dashboard', 'GET', '/partner/dashboard', {
    token: P,
    check: (b) => (typeof b?.occupancy?.percent === 'number' ? null : 'bad dashboard shape'),
  });
  await expect('GET /partner/payouts', 'GET', '/partner/payouts', {
    token: P, check: (b) => (Array.isArray(b?.items) ? null : 'no items array'),
  });
  await expect('GET /partner/bookings', 'GET', '/partner/bookings?limit=5', { token: P });
  await expect('GET /partner/reviews', 'GET', '/partner/reviews', { token: P });

  const propA = props?.[0];
  const rtA = propA?.roomTypes?.[0];

  if (propA) {
    await expect("partner B cannot edit partner A's property", 'PATCH',
      `/partner/properties/${propA.id}`, {
        token: partnerB.accessToken, status: 404, body: { name: 'Hijacked' },
      });
  }
  if (rtA) {
    await expect("partner B cannot read partner A's calendar", 'GET',
      `/partner/room-types/${rtA.id}/calendar?from=${day(1)}&to=${day(8)}`, {
        token: partnerB.accessToken, status: 404,
      });

    await expect('PATCH prices across a range', 'PATCH',
      `/partner/room-types/${rtA.id}/prices`, {
        token: P, body: { from: day(60), to: day(63), price: 777000 },
        check: (b) => (b?.nights === 3 ? null : `updated ${b?.nights} nights`),
      });
    const priced = await sql(
      `SELECT price FROM room_prices WHERE room_type_id = $1 AND date = $2`,
      [rtA.id, day(60)],
    );
    if (Number(priced[0]?.price) === 777000) ok('the new price is what the calendar reads back');
    else bad('the new price is what the calendar reads back', JSON.stringify(priced));

    await expect('PATCH inventory closes a range', 'PATCH',
      `/partner/room-types/${rtA.id}/inventory`, {
        token: P, body: { from: day(70), to: day(72), status: 'closed' },
        check: (b) => (b?.nights === 2 ? null : `updated ${b?.nights}`),
      });
    await expect('a closed night cannot be booked', 'POST', '/customer/bookings', {
      token: CFRESH, status: 409,
      body: { roomTypeId: rtA.id, checkIn: day(70), checkOut: day(72), guests: 1 },
    });
    // Put it back so a re-run starts clean.
    await call('PATCH', `/partner/room-types/${rtA.id}/inventory`, {
      token: P, body: { from: day(70), to: day(72), status: 'open' },
    });

    const walkIn = await expect('POST /partner/bookings/walk-in', 'POST',
      '/partner/bookings/walk-in', {
        token: P, status: 201,
        body: {
          roomTypeId: rtA.id, checkIn: day(50), checkOut: day(52), guests: 1,
          guestName: 'ທ້າວ ຍ່າງເຂົ້າມາ', guestPhone: '+856 20 8888 9999',
        },
        check: (b) => {
          if (b?.source !== 'walk_in') return `source is ${b?.source}`;
          if (b?.status !== 'confirmed') return `status is ${b?.status}`;
          // A walk-in pays at the desk: no platform service fee.
          if (b?.serviceFee !== 0) return `serviceFee is ${b?.serviceFee}, expected 0`;
          return null;
        },
      });

    if (walkIn) {
      await expect("partner B cannot read that booking", 'GET',
        `/partner/bookings/${walkIn.id}`, { token: partnerB.accessToken, status: 404 });
      await expect('the status ladder refuses a backwards move', 'PATCH',
        `/partner/bookings/${walkIn.id}/status`, {
          token: P, status: 400, body: { status: 'pending' },
        });
      await expect('PATCH status → staying', 'PATCH', `/partner/bookings/${walkIn.id}/status`, {
        token: P, body: { status: 'staying' },
      });
      await expect('PATCH status → completed', 'PATCH', `/partner/bookings/${walkIn.id}/status`, {
        token: P, body: { status: 'completed' },
      });
    }
  }

  // ── photo upload ──────────────────────────────────────────────────────────
  console.log('\nphoto upload');
  if (propA) {
    const uploaded = await expect('POST /partner/properties/:id/photos', 'POST',
      `/partner/properties/${propA.id}/photos`, {
        token: P, status: 201, form: imageForm(),
        check: (b) => (b?.photos?.length ? null : 'no photos returned'),
      });

    await expect('a non-image is refused', 'POST', `/partner/properties/${propA.id}/photos`, {
      token: P, status: 415,
      form: imageForm(Buffer.from('#!/bin/sh\n', 'utf8'), 'image/png', 'evil.png'),
    });
    await expect("partner B cannot upload to partner A's property", 'POST',
      `/partner/properties/${propA.id}/photos`, {
        token: partnerB.accessToken, status: 404, form: imageForm(),
      });

    if (uploaded) {
      const newest = uploaded.photos[uploaded.photos.length - 1];
      const served = await fetch(BASE.replace(/\/api$/, '') + newest.url);
      if (served.ok) ok('the uploaded photo is served', newest.url);
      else bad('the uploaded photo is served', `GET ${newest.url} → ${served.status}`);

      await expect('DELETE the photo', 'DELETE',
        `/partner/properties/${propA.id}/photos/${newest.id}`, { token: P });
    }
  }

  // ── admin API and RBAC ────────────────────────────────────────────────────
  console.log('\nadmin api & RBAC');
  await expect('GET /admin/dashboard', 'GET', '/admin/dashboard', {
    token: A, check: (b) => (typeof b?.gmv === 'number' ? null : 'bad shape'),
  });
  await expect('GET /admin/approvals', 'GET', '/admin/approvals', { token: A });
  await expect('GET /admin/partners', 'GET', '/admin/partners?limit=5', { token: A });
  await expect('GET /admin/customers', 'GET', '/admin/customers?limit=5', { token: A });
  await expect('GET /admin/bookings', 'GET', '/admin/bookings?limit=5', { token: A });
  await expect('GET /admin/audit-logs', 'GET', '/admin/audit-logs?limit=5', { token: A });

  await expect('GET /admin/payouts is refused for staff', 'GET', '/admin/payouts', {
    token: staff.accessToken, status: 403,
  });
  await expect('POST /admin/payouts/pay-all is refused for staff', 'POST',
    '/admin/payouts/pay-all', { token: staff.accessToken, status: 403 });
  await expect('GET /admin/payouts is allowed for finance', 'GET', '/admin/payouts', {
    token: finance.accessToken,
  });
  await expect('PATCH /admin/settings is refused for staff', 'PATCH', '/admin/settings', {
    token: staff.accessToken, status: 403, body: { commission_rate_app: 9 },
  });
  await expect('GET /admin/admins is refused for finance', 'GET', '/admin/admins', {
    token: finance.accessToken, status: 403,
  });

  // ── staff accounts ────────────────────────────────────────────────────────
  //
  // The only way an ADMIN row is ever created: no public route reaches it.
  console.log('\nstaff accounts');
  const staffEmail = `smoke.staff.${Date.now()}@laostay.la`;
  const staffPw = 'SmokeStaff@2026';

  await expect('POST /admin/admins is refused for finance', 'POST', '/admin/admins', {
    token: finance.accessToken, status: 403,
    body: { email: staffEmail, fullName: 'ບໍ່ຄວນຖືກສ້າງ', password: staffPw, adminRole: 'staff' },
  });

  const newAdmin = await expect('POST /admin/admins', 'POST', '/admin/admins', {
    token: A, status: 201,
    body: { email: staffEmail, fullName: 'ພະນັກງານທົດສອບ', password: staffPw, adminRole: 'staff' },
    check: (b) => (b?.adminRole === 'staff' ? null : `adminRole is ${b?.adminRole}`),
  });

  await expect('the same email twice is rejected', 'POST', '/admin/admins', {
    token: A, status: 409,
    body: { email: staffEmail, fullName: 'ຊ້ຳ', password: staffPw, adminRole: 'staff' },
  });

  if (newAdmin) {
    const fresh = await call('POST', '/auth/login', {
      body: { email: staffEmail, password: staffPw },
    });
    if (fresh.status === 200 && fresh.body?.user?.role === 'ADMIN') {
      ok('the new admin can sign in');
    } else {
      bad('the new admin can sign in', `${fresh.status} ${JSON.stringify(fresh.body)?.slice(0, 120)}`);
    }

    await expect('a new staff account cannot reach payouts', 'GET', '/admin/payouts', {
      token: fresh.body?.accessToken, status: 403,
    });

    await expect('DELETE /admin/admins/:id', 'DELETE', `/admin/admins/${newAdmin.id}`, {
      token: A,
      check: (b) => (b?.deleted === true ? null : JSON.stringify(b)),
    });

    // Soft-deleted, and the sessions revoked with it.
    const after = await call('POST', '/auth/login', {
      body: { email: staffEmail, password: staffPw },
    });
    if (after.status === 401) ok('a deleted admin can no longer sign in');
    else bad('a deleted admin can no longer sign in', `got ${after.status}`);
  }

  const whoami = await call('GET', '/auth/me', { token: A });
  await expect('deleting your own account is refused', 'DELETE',
    `/admin/admins/${whoami.body?.id}`, { token: A, status: 403 });

  // ── settings ──────────────────────────────────────────────────────────────
  console.log('\nsettings');
  const settingsBefore = await call('GET', '/admin/settings', { token: A });
  const originalFee = settingsBefore.body?.system?.service_fee_rate;
  const originalName = settingsBefore.body?.app?.platform_name;

  await expect('PATCH /admin/settings writes both halves', 'PATCH', '/admin/settings', {
    token: finance.accessToken,
    body: { service_fee_rate: 7, app: { platform_name: 'LaoStay · smoke' } },
    check: (b) => {
      if (b?.system?.service_fee_rate !== 7) {
        return `service_fee_rate is ${b?.system?.service_fee_rate}`;
      }
      if (b?.app?.platform_name !== 'LaoStay · smoke') {
        return `platform_name is ${b?.app?.platform_name}`;
      }
      return null;
    },
  });

  await expect('an unknown app key is ignored, not created', 'PATCH', '/admin/settings', {
    token: finance.accessToken,
    body: { app: { not_a_real_key: 'x' } },
    check: (b) => ('not_a_real_key' in (b?.app ?? {}) ? 'the unknown key was stored' : null),
  });

  await expect('a rate above 100 is rejected', 'PATCH', '/admin/settings', {
    token: finance.accessToken, status: 400, body: { service_fee_rate: 400 },
  });

  // Put the settings back so a re-run starts from the seeded values.
  await call('PATCH', '/admin/settings', {
    token: finance.accessToken,
    body: { service_fee_rate: originalFee, app: { platform_name: originalName } },
  });

  // ── approvals ─────────────────────────────────────────────────────────────
  console.log('\napprovals');
  const pending = await call('GET', '/admin/approvals', { token: A });
  const applicant = pending.body?.[0];
  if (applicant) {
    await expect('PATCH /admin/approvals/:id/approve', 'PATCH',
      `/admin/approvals/${applicant.id}/approve`, {
        token: A, check: (b) => (b?.status === 'verified' ? null : `status is ${b?.status}`),
      });
    await expect('approving twice is rejected', 'PATCH',
      `/admin/approvals/${applicant.id}/approve`, { token: A, status: 400 });

    const [props2] = await sql(
      `SELECT count(*)::int n FROM properties WHERE partner_id = $1 AND status = 'active'`,
      [applicant.id],
    );
    if (props2.n > 0) ok('approving a partner puts their properties on sale');
    else bad('approving a partner puts their properties on sale', 'still draft');
  }

  // ── payouts ───────────────────────────────────────────────────────────────
  console.log('\npayouts');
  const gen = await expect('POST /admin/payouts/generate', 'POST', '/admin/payouts/generate', {
    token: finance.accessToken,
    check: (b) => (typeof b?.created === 'number' ? null : 'no created count'),
  });
  if (gen) {
    const balance = await sql(`
      SELECT count(*)::int n FROM payouts p
      JOIN payout_items i ON i.payout_id = p.payout_id
      GROUP BY p.payout_id, p.gross_amount
      HAVING sum(i.gross_amount) <> p.gross_amount`);
    if (balance.length === 0) ok('every payout equals the sum of its items');
    else bad('every payout equals the sum of its items', `${balance.length} mismatched`);

    const list = await call('GET', '/admin/payouts?status=pending', { token: finance.accessToken });
    const first = list.body?.items?.[0];
    if (first) {
      await expect('GET /admin/payouts/:id/items', 'GET', `/admin/payouts/${first.id}/items`, {
        token: finance.accessToken,
        check: (b) => (b?.items?.length ? null : 'no items'),
      });
      await expect('PATCH /admin/payouts/:id/pay', 'PATCH', `/admin/payouts/${first.id}/pay`, {
        token: finance.accessToken,
        check: (b) => (b?.status === 'paid' ? null : `status is ${b?.status}`),
      });
      await expect('paying twice is rejected', 'PATCH', `/admin/payouts/${first.id}/pay`, {
        token: finance.accessToken, status: 400,
      });
      const payoutLedger = await sql(
        `SELECT count(*)::int n FROM ledger_entries WHERE entry_type = 'payout' AND reference_id = $1`,
        [first.id],
      );
      if (payoutLedger[0].n >= 1) ok('the payout reached the ledger');
      else bad('the payout reached the ledger', 'no payout entry');
    }
  }

  // ── notifications ─────────────────────────────────────────────────────────
  //
  // Every notification now renders from `notification_templates`. The check
  // that matters is that no `{{placeholder}}` survives into a message a guest
  // reads — an unfilled one means the caller and the template disagree.
  console.log('\nnotifications');

  const feed = await expect('GET /customer/notifications', 'GET', '/customer/notifications', {
    token: CFRESH,
    check: (b) => (Array.isArray(b?.items) && 'unread' in b ? null : 'bad shape'),
  });

  if (feed?.items?.length) {
    const unrendered = feed.items.filter((n) =>
      /\{\{\w+\}\}/.test(`${n.title} ${n.message ?? ''}`),
    );
    if (!unrendered.length) ok('no template placeholder survived into a message');
    else {
      bad(
        'no template placeholder survived into a message',
        unrendered.map((n) => n.message ?? n.title).join(' | ').slice(0, 160),
      );
    }

    const shaped = feed.items.every(
      (n) => n.id && n.title && 'isRead' in n && 'type' in n && 'referenceType' in n,
    );
    if (shaped) ok('the feed shape is complete');
    else bad('the feed shape is complete', JSON.stringify(feed.items[0]).slice(0, 160));

    await expect('POST /customer/notifications/:id/read', 'POST',
      `/customer/notifications/${feed.items[0].id}/read`, { token: CFRESH });
  }

  await expect('the partner feed uses the same shape', 'GET', '/partner/notifications', {
    token: P,
    check: (b) => (Array.isArray(b?.items) && 'unread' in b ? null : 'shape differs'),
  });

  const dash = await call('GET', '/partner/dashboard', { token: P });
  if (typeof dash.body?.unreadNotifications === 'number') {
    ok('the partner dashboard reports a real unread count', `${dash.body.unreadNotifications}`);
  } else {
    bad('the partner dashboard reports a real unread count', String(dash.body?.unreadNotifications));
  }

  await expect('POST /customer/notifications/read-all', 'POST',
    '/customer/notifications/read-all', { token: CFRESH });
  const [{ n: stillUnread }] = await sql(
    `SELECT count(*)::int n FROM notifications
      WHERE user_id = (SELECT user_id FROM users WHERE email = 'souda.v@gmail.com')
        AND is_read = false`,
  );
  if (stillUnread === 0) ok('read-all left nothing unread');
  else bad('read-all left nothing unread', `${stillUnread} remain`);

  // ── chat ──────────────────────────────────────────────────────────────────
  console.log('\nchat');

  const chatProperty = listing?.id ?? propA?.id;
  const thread = await expect('POST /customer/conversations', 'POST', '/customer/conversations', {
    token: CFRESH,
    status: 201,
    body: { propertyId: chatProperty },
    check: (b) => (b?.id ? null : 'no conversation id'),
  });

  if (thread) {
    // Opening a second thread with the same property must return the first —
    // two would split the history and leave half of it unread forever.
    const again = await call('POST', '/customer/conversations', {
      token: CFRESH,
      body: { propertyId: chatProperty },
    });
    if (String(again.body?.id) === String(thread.id)) ok('a second open thread is not created');
    else bad('a second open thread is not created', `${again.body?.id} vs ${thread.id}`);

    const sent = await expect('POST a message as the guest', 'POST',
      `/customer/conversations/${thread.id}/messages`, {
        token: CFRESH,
        status: 201,
        body: { text: 'ສະບາຍດີ ມີບ່ອນຈອດລົດບໍ?' },
        check: (b) => (b?.mine === true && b?.text ? null : JSON.stringify(b)),
      });

    // The trigger owns the preview — nothing in the service writes it.
    const [conv] = await sql(
      `SELECT last_message_id FROM conversations WHERE conversation_id = $1`,
      [thread.id],
    );
    if (conv?.last_message_id && String(conv.last_message_id) === String(sent?.id)) {
      ok('the trigger set conversations.last_message_id');
    } else {
      bad('the trigger set conversations.last_message_id', JSON.stringify(conv));
    }

    // Which partner owns this property decides who may read the thread.
    const [{ email: hostEmail }] = await sql(
      `SELECT u.email FROM properties p
         JOIN partners pt ON pt.partner_id = p.partner_id
         JOIN users u     ON u.user_id     = pt.user_id
        WHERE p.property_id = $1`,
      [chatProperty],
    );
    const host = await login(hostEmail, PARTNER_PW);
    const outsider =
      hostEmail === 'vintage@laostay.la' ? partnerB.accessToken : partnerA.accessToken;

    await expect("a partner cannot read another property's thread", 'GET',
      `/partner/conversations/${thread.id}/messages`, { token: outsider, status: 404 });

    const hostThreadUnread = async () => {
      const list = await call('GET', '/partner/conversations', { token: host.accessToken });
      return list.body?.items?.find((i) => String(i.id) === String(thread.id))?.unread;
    };

    const hostView = await expect('the host sees the thread', 'GET', '/partner/conversations', {
      token: host.accessToken,
      check: (b) =>
        b?.items?.some((i) => String(i.id) === String(thread.id))
          ? null
          : 'the thread is not in the list',
    });

    if (hostView) {
      // Unread is checked as a delta, not an absolute: the thread survives a
      // re-run of this suite and would otherwise accumulate.
      await call('POST', `/partner/conversations/${thread.id}/read`, { token: host.accessToken });
      const hostBefore = await hostThreadUnread();

      await call('POST', `/customer/conversations/${thread.id}/messages`, {
        token: CFRESH,
        body: { text: 'ອີກຄຳຖາມໜຶ່ງ — ເຊັກອິນໄດ້ຈັກໂມງ?' },
      });
      const hostAfter = await hostThreadUnread();

      if (hostBefore === 0 && hostAfter === 1) {
        ok("a message from the other side becomes unread", `${hostBefore} → ${hostAfter}`);
      } else {
        bad("a message from the other side becomes unread", `${hostBefore} → ${hostAfter}`);
      }

      // `since` is a message id, so polling returns only what is genuinely new.
      // Anchored on the newest message in the thread: asking for everything
      // after it must return nothing, and after the host's next reply, exactly
      // that reply.
      const latest = await call('GET', `/customer/conversations/${thread.id}/messages`, {
        token: CFRESH,
      });
      const newestId = latest.body?.items?.at(-1)?.id;

      const none = await call('GET',
        `/customer/conversations/${thread.id}/messages?since=${newestId}`, { token: CFRESH });
      if (none.body?.items?.length === 0) ok('?since past the newest returns nothing');
      else bad('?since past the newest returns nothing', `${none.body?.items?.length} returned`);

      await expect('the host replies', 'POST',
        `/partner/conversations/${thread.id}/messages`, {
          token: host.accessToken,
          status: 201,
          body: { text: 'ມີເດີ້ ຈອດໄດ້ຟຣີ' },
        });

      const afterReply = await call('GET',
        `/customer/conversations/${thread.id}/messages?since=${newestId}`, { token: CFRESH });
      if (afterReply.body?.items?.length === 1) ok('?since then returns exactly the new reply');
      else bad('?since then returns exactly the new reply', `${afterReply.body?.items?.length}`);


      await expect('POST read moves the cursor', 'POST',
        `/partner/conversations/${thread.id}/read`, { token: host.accessToken });

      const after = await call('GET', '/partner/conversations/unread', { token: host.accessToken });
      if (after.body?.total === 0) ok('reading the thread cleared the unread count');
      else bad('reading the thread cleared the unread count', `total=${after.body?.total}`);

      // "Your own messages do not count" stated as a difference rather than an
      // absolute: read the thread to zero, send one more, and it must still be
      // zero. An absolute count would only hold on a freshly seeded database
      // and would drift on every re-run.
      const threadUnread = async () => {
        const list = await call('GET', '/customer/conversations', { token: CFRESH });
        return {
          list,
          unread: list.body?.items?.find((i) => String(i.id) === String(thread.id))?.unread,
        };
      };

      await call('POST', `/customer/conversations/${thread.id}/read`, { token: CFRESH });
      const readToZero = await threadUnread();
      if (readToZero.unread === 0) ok('reading clears the guest side too');
      else bad('reading clears the guest side too', `unread=${readToZero.unread}`);

      await call('POST', `/customer/conversations/${thread.id}/messages`, {
        token: CFRESH,
        body: { text: 'ຂອບໃຈເດີ້' },
      });
      const afterOwn = await threadUnread();
      if (afterOwn.unread === 0) ok('your own messages do not count as unread');
      else bad('your own messages do not count as unread', `unread=${afterOwn.unread}`);

      // And the global badge is the sum of the per-thread counts, not something
      // computed a second, different way.
      const badge = await call('GET', '/customer/conversations/unread', { token: CFRESH });
      const summed = (afterOwn.list.body?.items ?? []).reduce((t, i) => t + i.unread, 0);
      if (badge.body?.total === summed) {
        ok('the unread badge equals the sum of the threads', `${summed}`);
      } else {
        bad('the unread badge equals the sum of the threads', `${badge.body?.total} vs ${summed}`);
      }

      await expect('an admin can read the thread', 'GET',
        `/admin/conversations/${thread.id}/messages`, { token: A });

      await expect('an empty message is refused', 'POST',
        `/customer/conversations/${thread.id}/messages`, {
          token: CFRESH, status: 400, body: { text: '   ' },
        });

      await expect('deleting your own message', 'DELETE',
        `/customer/conversations/${thread.id}/messages/${sent?.id}`, {
          token: CFRESH,
          check: (b) => (b?.deleted === true ? null : JSON.stringify(b)),
        });
      await expect('deleting it twice is refused', 'DELETE',
        `/customer/conversations/${thread.id}/messages/${sent?.id}`, {
          token: CFRESH, status: 404,
        });
    }
  }

  // ── review replies ────────────────────────────────────────────────────────
  console.log('\nreview replies');

  const [reviewRow] = await sql(
    `SELECT r.review_id, u.email AS host_email
       FROM reviews r
       JOIN properties p ON p.property_id = r.property_id
       JOIN partners pt  ON pt.partner_id = p.partner_id
       JOIN users u      ON u.user_id     = pt.user_id
      ORDER BY r.review_id LIMIT 1`,
  );

  if (reviewRow) {
    const reviewId = reviewRow.review_id;
    await expect('GET /reviews/:id needs no token', 'GET', `/reviews/${reviewId}`, {
      check: (b) => (b?.id && Array.isArray(b.replies) ? null : 'bad shape'),
    });

    const replyHost = await login(reviewRow.host_email, PARTNER_PW);
    const outsider =
      reviewRow.host_email === 'vintage@laostay.la'
        ? partnerB.accessToken
        : partnerA.accessToken;

    // `review_replies.user_id` accepts any user, so this rule lives only in the
    // service — a hole here would let anyone answer for a property.
    await expect('an unrelated partner cannot reply', 'POST', `/reviews/${reviewId}/replies`, {
      token: outsider,
      status: 403,
      body: { text: 'ບໍ່ແມ່ນທີ່ພັກຂອງຂ້ອຍ' },
    });

    const replied = await expect('the host replies to a review', 'POST',
      `/reviews/${reviewId}/replies`, {
        token: replyHost.accessToken,
        status: 201,
        body: { text: 'ຂອບໃຈຫຼາຍໆ ທີ່ມາພັກນຳກັນ' },
        check: (b) =>
          b?.replies?.length && b?.replyId ? null : 'no reply, or no id for the row just written',
      });

    if (replied) {
      const [{ n }] = await sql(
        `SELECT count(*)::int n FROM notifications
          WHERE reference_type = 'review' AND reference_id = $1`,
        [reviewId],
      );
      if (n >= 1) ok('the guest was told their review was answered');
      else bad('the guest was told their review was answered', 'no notification');

      // The id of the row just written, not the last root of the tree — a
      // nested reply is a child, so the newest is not always last.
      const replyId = replied.replyId;

      await expect('a nested reply must belong to the same review', 'POST',
        `/reviews/${reviewId}/replies`, {
          token: replyHost.accessToken,
          status: 400,
          body: { text: 'ຕອບຜິດບ່ອນ', parentReplyId: '99999999' },
        });

      await expect('deleting the reply', 'DELETE', `/reviews/${reviewId}/replies/${replyId}`, {
        token: replyHost.accessToken,
      });
    }
  }

  // ── CMS ───────────────────────────────────────────────────────────────────
  console.log('\ncms');

  await expect('GET /content/home is public', 'GET', '/content/home', {
    check: (b) =>
      Array.isArray(b?.banners) && Array.isArray(b?.announcements) ? null : 'bad shape',
  });
  await expect('GET /content/faqs is public and grouped', 'GET', '/content/faqs', {
    check: (b) => (Array.isArray(b) && b[0]?.items?.length ? null : 'not grouped'),
  });
  await expect('GET /content/pages lists only live pages', 'GET', '/content/pages', {
    check: (b) => {
      if (!Array.isArray(b)) return 'not an array';
      // The three legal pages ship inactive with placeholder text on purpose.
      const legal = b.filter((p) => ['terms', 'privacy', 'partner_agreement'].includes(p.slug));
      return legal.length ? `inactive legal pages served: ${legal.map((p) => p.slug)}` : null;
    },
  });
  await expect('an inactive page 404s rather than serving a placeholder', 'GET',
    '/content/pages/terms', { status: 404 });
  await expect('an active page is served', 'GET', '/content/pages/about', {
    check: (b) => (b?.slug === 'about' ? null : JSON.stringify(b)),
  });

  await expect('a customer cannot edit content', 'POST', '/admin/content/faqs', {
    token: CFRESH, status: 403, body: { question: 'ບໍ່ຄວນໄດ້', answer: 'ບໍ່ຄວນໄດ້' },
  });

  const faq = await expect('POST /admin/content/faqs', 'POST', '/admin/content/faqs', {
    token: A,
    status: 201,
    body: { category: 'ທົດສອບ', question: `smoke ${Date.now()}?`, answer: 'ຄຳຕອບທົດສອບ' },
    check: (b) => (b?.id ? null : JSON.stringify(b)),
  });

  const banner = await expect('a banner pointing at a real property', 'POST',
    '/admin/content/banners', {
      token: A,
      status: 201,
      body: {
        title: 'smoke banner',
        targetType: 'property',
        targetId: chatProperty,
        displayOrder: 99,
      },
      check: (b) => (b?.id ? null : JSON.stringify(b)),
    });

  // `(target_type, target_id)` has no foreign key, so nothing but this check
  // stops a banner linking to a property that does not exist.
  await expect('a banner pointing at nothing is refused', 'POST', '/admin/content/banners', {
    token: A,
    status: 400,
    body: { title: 'broken', targetType: 'property', targetId: '99999999' },
  });

  const page = await expect('POST /admin/content/pages upserts by slug', 'POST',
    '/admin/content/pages', {
      token: A,
      status: 201,
      body: { slug: 'about', title: 'ກ່ຽວກັບ LaoStay', content: '<p>smoke</p>', isActive: true },
      check: (b) => (b?.slug === 'about' ? null : JSON.stringify(b)),
    });
  if (page) {
    const [{ n }] = await sql(`SELECT count(*)::int n FROM app_pages WHERE page_slug = 'about'`);
    if (n === 1) ok('the upsert did not create a second "about"');
    else bad('the upsert did not create a second "about"', `${n} rows`);
  }

  await expect('a bad slug is refused', 'POST', '/admin/content/pages', {
    token: A, status: 400, body: { slug: 'Not A Slug', title: 'x' },
  });

  // Clean up so a re-run starts from the seeded content.
  if (faq) await call('DELETE', `/admin/content/faqs/${faq.id}`, { token: A });
  if (banner) await call('DELETE', `/admin/content/banners/${banner.id}`, { token: A });

  // ── database invariants ───────────────────────────────────────────────────
  console.log('\ndatabase invariants');
  const invariants = [
    ['no room is oversold',
      `SELECT count(*)::int n FROM room_inventory WHERE held_count + booked_count > total_count`],
    ['available_count agrees with its parts',
      `SELECT count(*)::int n FROM room_inventory
        WHERE available_count <> total_count - held_count - booked_count`],
    ['no negative counters',
      `SELECT count(*)::int n FROM room_inventory WHERE held_count < 0 OR booked_count < 0`],
    ['booking totals balance',
      `SELECT count(*)::int n FROM bookings
        WHERE subtotal_amount + service_fee + tax_amount + cleaning_fee - discount_amount
              <> total_amount`],
    ['booking payout = total - commission',
      `SELECT count(*)::int n FROM bookings WHERE total_amount - commission_amount <> payout_amount`],
    ['payout gross = commission + net',
      `SELECT count(*)::int n FROM payouts WHERE gross_amount <> commission_amount + net_amount`],
    ['payout_items gross = commission + net',
      `SELECT count(*)::int n FROM payout_items WHERE gross_amount <> commission_amount + net_amount`],
    ['no ledger entry is negative',
      `SELECT count(*)::int n FROM ledger_entries WHERE amount < 0`],
  ];
  for (const [name, query] of invariants) {
    const [row] = await sql(query);
    if (row.n === 0) ok(name);
    else bad(name, `${row.n} offending row(s)`);
  }

  await db.end();

  console.log('\n' + '─'.repeat(64));
  console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('');
    for (const f of failures) console.log(`  · ${f}`);
  }
  console.log('─'.repeat(64) + '\n');
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\nSmoke run crashed:', e.message);
  await db?.end().catch(() => undefined);
  process.exit(1);
});

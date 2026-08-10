/** Captures real responses so the API document quotes the server, not a guess. */
import { writeFile } from 'node:fs/promises';

const API = 'http://localhost:3100/api';
const out = {};

const call = async (name, path, { token, method = 'GET', body } = {}) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  out[name] = { path, method, status: res.status, body: text ? JSON.parse(text) : null };
  console.log(`  ${String(res.status).padEnd(4)} ${method.padEnd(5)} ${path}`);
  return out[name].body;
};

const login = await call('auth.login', '/auth/login', {
  method: 'POST',
  body: { email: 'souda.v@gmail.com', password: 'Customer@2026' },
});
const token = login.accessToken;

const day = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const checkIn = day(30);
const checkOut = day(33);

await call('auth.me', '/auth/me', { token });

// ── browsing, no account needed ─────────────────────────────────────────────
const search = await call(
  'catalog.search',
  `/properties?checkIn=${checkIn}&checkOut=${checkOut}&guests=2&limit=2`,
);
const propertyId = search.items?.[0]?.id ?? '1';
const detail = await call(
  'catalog.property',
  `/properties/${propertyId}?checkIn=${checkIn}&checkOut=${checkOut}`,
);
const roomTypeId =
  detail.roomTypes?.find((r) => r.available > 0)?.id ?? detail.roomTypes?.[0]?.id;
await call('catalog.calendar', `/properties/${propertyId}/calendar?from=${checkIn}&to=${checkOut}`);
await call('catalog.provinces', '/locations/provinces');
await call('catalog.districts', '/locations/districts?provinceId=1');
await call('catalog.amenities', '/amenities');

// ── content ─────────────────────────────────────────────────────────────────
await call('content.home', '/content/home');
await call('content.faqs', '/content/faqs');
await call('content.pages', '/content/pages');
await call('content.page', '/content/pages/about');

// ── the customer's own things ───────────────────────────────────────────────
await call('customer.me', '/customer/me', { token });
const trips = await call('customer.bookings', '/customer/bookings?limit=2', { token });
const bookingId = trips.items?.[0]?.id;
if (bookingId) await call('customer.booking', `/customer/bookings/${bookingId}`, { token });
await call('customer.wishlist', '/customer/wishlist', { token });
await call('customer.notifications', '/customer/notifications', { token });
await call('customer.conversations', '/customer/conversations', { token });
await call('customer.unread', '/customer/conversations/unread', { token });

const threads = out['customer.conversations'].body;
const conversationId = threads.items?.[0]?.id;
if (conversationId) {
  await call('customer.messages', `/customer/conversations/${conversationId}/messages?limit=2`, {
    token,
  });
}

// Writes nothing — it only prices a stay.
if (roomTypeId) {
  await call('customer.quote', '/customer/bookings/quote', {
    token,
    method: 'POST',
    body: { roomTypeId, checkIn, checkOut, guests: 2 },
  });
}

// ── a public review thread ──────────────────────────────────────────────────
const reviewId = detail.reviews?.[0]?.id;
if (reviewId) await call('reviews.thread', `/reviews/${reviewId}`);

// ── the shapes of failure ───────────────────────────────────────────────────
await call('err.401', '/customer/me');
await call('err.404', '/properties/999999');
await call('err.422', '/auth/login', {
  method: 'POST',
  body: { email: 'not-an-email', password: 'x' },
});
await call('err.409', '/customer/bookings', {
  token,
  method: 'POST',
  body: { roomTypeId: roomTypeId ?? '1', checkIn: '2020-01-01', checkOut: '2020-01-02', guests: 2 },
});

await writeFile(
  'scripts/_capture.json',
  JSON.stringify(out, null, 2).replace(/eyJ[\w.-]{20,}/g, '<token>'),
  'utf8',
);
console.log(`\n  ${Object.keys(out).length} responses → scripts/_capture.json`);

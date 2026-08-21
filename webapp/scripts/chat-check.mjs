/**
 * Chat and review replies, driven in a real browser against the live API.
 *
 * The guest side is the browser; the host side is the API, because there is no
 * partner web app — the host uses the Flutter app, and what matters here is
 * that the guest sees what the host sent.
 *
 * Writes rows: one `conversations` (reused on a second run), a few `messages`,
 * a `conversation_reads` cursor, and one `review_replies` which it deletes
 * again at the end.
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5174';
const API = 'http://localhost:3100/api';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const GUEST = { email: 'souda.v@gmail.com', password: 'Customer@2026' };
const HOST = { email: 'vintage@phaphak.la', password: 'Partner@2026' };

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

// ── the host, over plain HTTP ────────────────────────────────────────────────

async function apiCall(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
  return json;
}

const hostLogin = await apiCall('/auth/login', {
  method: 'POST',
  body: { email: HOST.email, password: HOST.password },
});
const hostToken = hostLogin.accessToken;

const hostProperties = await apiCall('/partner/properties', { token: hostToken });
const property = hostProperties[0];
if (!property) {
  console.log('\n  the seeded host owns no property — nothing to test against\n');
  process.exit(1);
}

console.log(`\nChat and review replies — ${property.name}\n`);

// ── the guest, in a browser ─────────────────────────────────────────────────

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
  if (res.url().includes('/api/') && res.status() >= 400 && !res.url().endsWith('/auth/me')) {
    note('http', `${res.status()} ${new URL(res.url()).pathname}`);
  }
});

const text = () => page.$eval('body', (b) => b.innerText);

await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[type="email"]');
await page.type('input[type="email"]', GUEST.email);
await page.type('input[type="password"]', GUEST.password);
await page.click('button[type="submit"]');
await page.waitForFunction(() => document.body.innerText.includes('ການເດີນທາງຂອງຂ້ອຍ'), {
  timeout: 30_000,
});

// ── asking the host a question ──────────────────────────────────────────────

// The button stays disabled until the session check lands, so waiting for it
// to be enabled is waiting for "the app knows who this is".
await page.goto(`${BASE}/property/${property.id}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('[data-testid="ask-host"]:not([disabled])', { timeout: 40_000 });
await page.click('[data-testid="ask-host"]');

const inThread = await page
  .waitForFunction(() => /\/messages\/\d+/.test(location.pathname), { timeout: 25_000 })
  .then(() => true)
  .catch(() => false);
check('asking the host opens a thread', inThread, page.url().replace(BASE, ''));

const conversationId = page.url().split('/messages/')[1];

// Pressing it again must land on the same thread rather than open a second.
await page.goto(`${BASE}/property/${property.id}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('[data-testid="ask-host"]:not([disabled])', { timeout: 40_000 });
await page.click('[data-testid="ask-host"]');
await page.waitForFunction(() => /\/messages\/\d+/.test(location.pathname), { timeout: 40_000 });
check(
  'asking twice reuses the same thread',
  page.url().endsWith(`/messages/${conversationId}`),
  `${conversationId} vs ${page.url().split('/messages/')[1]}`,
);

const question = `ມີບ່ອນຈອດລົດບໍ? (check ${Date.now()})`;
await page.waitForSelector('form input', { timeout: 20_000 });
await page.type('form input', question);
await page.click('button[type="submit"]');

const sent = await page
  .waitForFunction((q) => document.body.innerText.includes(q), { timeout: 20_000 }, question)
  .then(() => true)
  .catch(() => false);
check('a sent message appears in the thread', sent);

// ── the host answers ────────────────────────────────────────────────────────

const hostThreads = await apiCall('/partner/conversations', { token: hostToken });
const hostThread = hostThreads.items?.find((t) => t.id === conversationId);
check('the host sees the same thread', !!hostThread, `${hostThreads.items?.length ?? 0} thread(s)`);
check(
  "the host's list counts the guest's message as unread",
  (hostThread?.unread ?? 0) > 0,
  `unread=${hostThread?.unread}`,
);

// The trigger owns `last_message_at` — nothing writes it from code, so this is
// really a check that the trigger fired.
check(
  'the conversation carries the last message the trigger recorded',
  hostThread?.lastMessage === question,
  `${hostThread?.lastMessage}`,
);

const answer = `ມີເດີ ຈອດໄດ້ 3 ຄັນ (check ${Date.now()})`;
await apiCall(`/partner/conversations/${conversationId}/messages`, {
  token: hostToken,
  method: 'POST',
  body: { text: answer },
});

// The open thread polls every 5s; give it two ticks before giving up.
const gotAnswer = await page
  .waitForFunction((a) => document.body.innerText.includes(a), { timeout: 15_000 }, answer)
  .then(() => true)
  .catch(() => false);
check('the open thread polls in the reply without a reload', gotAnswer);

// A hard page load re-checks the session before rendering anything behind
// RequireAuth, and every authenticated call costs a round trip to a remote
// database — so wait for the content, never for the clock.
await page.goto(`${BASE}/messages`, { waitUntil: 'networkidle2' });
const listed = await page
  .waitForFunction((name) => document.body.innerText.includes(name), { timeout: 40_000 },
    property.name)
  .then(() => true)
  .catch(() => false);
check('the conversations list shows the thread', listed);

const list = await text();
check('the reply is the last line shown', list.includes(answer.slice(0, 20)));

// Unread is asserted per thread, not on the platform-wide total: this account
// has other conversations, and a total that happens to be zero would only mean
// nobody else has written lately.
const guestThreads = await page.evaluate(async (api) => {
  const token = localStorage.getItem('phaphak.guest.accessToken');
  const res = await fetch(`${api}/customer/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}, API);
const guestThread = guestThreads.items?.find((t) => t.id === conversationId);
check(
  'opening the thread cleared its own unread count',
  guestThread?.unread === 0,
  `unread=${guestThread?.unread}`,
);
check(
  'the total is the sum of the threads, not a separate counter',
  guestThreads.unreadTotal ===
    guestThreads.items.reduce((sum, t) => sum + t.unread, 0),
  `total=${guestThreads.unreadTotal}`,
);

// The two sides keep separate cursors: the guest reading theirs must not have
// cleared the host's.
const hostBefore = await apiCall('/partner/conversations', { token: hostToken });
check(
  "the guest reading their side left the host's unread alone",
  (hostBefore.items?.find((t) => t.id === conversationId)?.unread ?? 0) > 0,
  `unread=${hostBefore.items?.find((t) => t.id === conversationId)?.unread}`,
);

await apiCall(`/partner/conversations/${conversationId}/read`, {
  token: hostToken,
  method: 'POST',
});
const hostAfter = await apiCall('/partner/conversations', { token: hostToken });
check(
  'the host can clear their own side',
  hostAfter.items?.find((t) => t.id === conversationId)?.unread === 0,
  `unread=${hostAfter.items?.find((t) => t.id === conversationId)?.unread}`,
);

// ── someone else's thread ───────────────────────────────────────────────────

const otherHost = await apiCall('/auth/login', {
  method: 'POST',
  body: { email: 'homsabay@phaphak.la', password: 'Partner@2026' },
}).catch(() => null);

if (otherHost?.accessToken) {
  const status = await fetch(`${API}/partner/conversations/${conversationId}`, {
    headers: { Authorization: `Bearer ${otherHost.accessToken}` },
  }).then((r) => r.status);
  check(
    "another host gets 404 for someone else's thread, not 403",
    status === 404,
    `status=${status}`,
  );
}

// ── review replies ──────────────────────────────────────────────────────────

const publicProperty = await apiCall(`/properties/${property.id}`);
const review = publicProperty.reviews?.[0];

let replyId = null;
if (!review) {
  console.log('  --   the host has no reviews yet, skipping the reply checks');
} else {
  const replyText = `ຂອບໃຈຫຼາຍເດີ (check ${Date.now()})`;
  const reply = await apiCall(`/reviews/${review.id}/replies`, {
    token: hostToken,
    method: 'POST',
    body: { text: replyText },
  });
  // `replyId` is the row just written; `id` on the same response is the
  // review's, so taking the wrong one silently deletes nothing.
  replyId = reply?.replyId;
  check('the host can reply to a review of their property', !!replyId, `reply #${replyId}`);

  // Public — no account needed to read the exchange.
  const thread = await apiCall(`/reviews/${review.id}`);
  check(
    'the public review thread carries the reply',
    thread.replies?.some((r) => r.text === replyText),
    `${thread.replies?.length ?? 0} repl(ies)`,
  );

  await page.goto(`${BASE}/property/${property.id}`, { waitUntil: 'networkidle2' });
  const shown = await page
    .waitForFunction((t) => document.body.innerText.includes(t), { timeout: 40_000 }, replyText)
    .then(() => true)
    .catch(() => false);
  check("the property page shows the host's reply under the review", shown);

  // A guest who is neither the author nor the host must be refused.
  const guestToken = await page.evaluate(() => localStorage.getItem('phaphak.guest.accessToken'));
  const me = await apiCall('/customer/me', { token: guestToken });
  const notMine = publicProperty.reviews?.find((r) => r.guest !== me.fullName);

  if (!notMine) {
    console.log('  --   every review here was written by the test guest, skipping the refusal check');
  } else {
    const refused = await fetch(`${API}/reviews/${notMine.id}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guestToken}` },
      body: JSON.stringify({ text: 'ຂ້ອຍບໍ່ກ່ຽວ' }),
    }).then((r) => r.status);
    check(
      'a guest who did not write the review cannot reply to it',
      refused === 403 || refused === 404,
      `status=${refused}`,
    );
  }

  // Put the review back the way it was found.
  if (replyId) {
    await apiCall(`/reviews/${review.id}/replies/${replyId}`, {
      token: hostToken,
      method: 'DELETE',
    });
    const after = await apiCall(`/reviews/${review.id}`);
    check(
      'deleting the reply removes it from the public thread',
      !after.replies?.some((r) => r.id === replyId),
    );
  }
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

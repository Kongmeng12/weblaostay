/**
 * Anonymous browsing: home → search → property page.
 *
 * Read-only. Nothing here signs in or writes a row, so it can run against the
 * live API freely.
 */
import puppeteer from 'puppeteer-core';

// Overridable so the same pass can be pointed at the deployed site, where the
// SPA and the API share an origin, as well as at the dev server that proxies
// /api. `SMOKE_BASE` does the same job for the API smoke test.
const BASE = process.env.BROWSE_BASE ?? 'http://localhost:5174';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const problems = [];
const seen = new Set();

/** Paths this run expects to 404 — armed only while probing a draft page. */
const expected404 = new Set();

function note(kind, text) {
  const key = `${kind}:${text}`;
  if (seen.has(key)) return;
  seen.add(key);
  problems.push(`${kind}  ${text}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });

page.on('console', (msg) => {
  // Chrome logs its own "Failed to load resource: 404" for a fetch the page
  // handled on purpose. It carries no URL, so it is dropped whole while a
  // deliberate 404 is armed. The reason phrase is matched loosely because
  // HTTP/2 does not carry one: the deployed site says "404 ()" where the
  // dev server says "404 (Not Found)".
  if (msg.type() !== 'error') return;
  if (expected404.size && /\b404\b/.test(msg.text())) return;
  // "Failed to load resource" carries no URL and is always the echo of a
  // request the two handlers below already report, with the address attached.
  // Keeping both means every foreign-origin failure is counted twice, once
  // unidentifiably.
  if (msg.text().startsWith('Failed to load resource')) return;
  note('console', msg.text().slice(0, 200));
});
page.on('pageerror', (err) => note('pageerror', String(err.message).slice(0, 200)));
page.on('requestfailed', (req) => {
  // Only this app's own requests. Cloudflare injects its analytics beacon into
  // every response from the deployed site, and it cannot load here — reporting
  // that on every run would bury the failures this check exists to find.
  if (!req.url().startsWith(BASE)) return;
  note('requestfailed', `${req.url()} ${req.failure()?.errorText}`);
});
page.on('response', async (res) => {
  if (!res.url().includes('/api/') || res.status() < 400) return;
  const path = new URL(res.url()).pathname;
  if (res.status() === 404 && expected404.has(path)) return;
  note('http', `${res.status()} ${path}`);
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => page.$eval('body', (b) => b.innerText);

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

console.log('\nAnonymous browsing\n');

// ── home ─────────────────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle2' });
// Wait for the featured cards themselves, not the section heading — the
// heading is static and renders before any data arrives.
await page
  .waitForSelector('a[href^="/property/"]', { timeout: 20_000 })
  .catch(() => undefined);
await settle(400);

const home = await text();
check('home renders the hero', home.includes('ຈອງທີ່ພັກທົ່ວລາວ'));
check('home lists destinations', home.includes('ຈຸດໝາຍຍອດນິຍົມ'));
check('home shows featured properties', /₭[\d,]+/.test(home), 'no price on any card');

// ── search without dates ─────────────────────────────────────────────────────
await page.goto(`${BASE}/search`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => /ພົບ\s*\d+\s*ທີ່ພັກ/.test(document.body.innerText), { timeout: 20_000 }).catch(() => undefined);
await settle(400);

const undated = await text();
const undatedTotal = Number(/ພົບ\s*(\d+)\s*ທີ່ພັກ/.exec(undated)?.[1] ?? -1);
check('search without dates returns every active property', undatedTotal > 0, `total=${undatedTotal}`);

// ── search WITH dates: must narrow to genuinely available stock ──────────────
const day = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

await page.goto(`${BASE}/search?checkIn=${day(20)}&checkOut=${day(23)}&guests=2`, {
  waitUntil: 'networkidle2',
});
await page.waitForFunction(() => /ພົບ\s*\d+\s*ທີ່ພັກ/.test(document.body.innerText), { timeout: 20_000 }).catch(() => undefined);
await settle(400);

const dated = await text();
check('a dated search says it filtered by real availability', dated.includes('ວ່າງຈິງ'));
check('a dated search prices the whole stay', /\/\s*3\s*ຄືນ/.test(dated), 'no "/ 3 ຄືນ" on any card');

// ── property page ────────────────────────────────────────────────────────────
const href = await page.$eval('a[href^="/property/"]', (a) => a.getAttribute('href'));
await page.goto(BASE + href, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.body.innerText.includes('ຫ້ອງວ່າງ'), { timeout: 20_000 }).catch(() => undefined);
await settle(600);

const detail = await text();
check('property page keeps the dates from the search', detail.includes('ຫ້ອງວ່າງ · 3 ຄືນ'), href);
check('property page shows amenities', detail.includes('ສິ່ງອຳນວຍຄວາມສະດວກ'));
check('property page shows the cancellation policy', detail.includes('ນະໂຍບາຍການຍົກເລີກ'));
check('property page shows house rules', detail.includes('ກົດລະບຽບທີ່ພັກ'));
check('booking bar prompts for a room', detail.includes('ເລືອກຫ້ອງເພື່ອຈອງ'));

// The location block. It renders whether or not the property has coordinates,
// so the section itself is always expected; the map only when there is a pin
// to put on it. Tiles come from a third party, and the requestfailed handler
// above deliberately ignores foreign origins — so a dead tile server would go
// unnoticed unless something checks that a tile actually arrived.
const location = await page.evaluate(async () => {
  const block = document.querySelector('[data-testid="location"]');
  if (!block) return { found: false };
  const map = block.querySelector('[data-testid="property-map"]');
  if (!map) return { found: true, map: false, link: !!block.querySelector('a[href*="google.com/maps"]') };

  // Leaflet appends tiles as it loads them; give the first one a moment.
  const loaded = async () => {
    for (let i = 0; i < 40; i++) {
      const tiles = [...map.querySelectorAll('img.leaflet-tile')];
      if (tiles.some((t) => t.complete && t.naturalWidth > 0)) return tiles.length;
      await new Promise((r) => setTimeout(r, 250));
    }
    return 0;
  };
  return {
    found: true,
    map: true,
    tiles: await loaded(),
    attribution: (map.querySelector('.leaflet-control-attribution')?.textContent ?? '').includes(
      'OpenStreetMap',
    ),
    link: !!block.querySelector('a[href*="google.com/maps"]'),
  };
});

check('the property page shows a location block', location.found);
check('the location block links out to Google Maps', location.link, location.map ? 'with a pin' : 'address only');
if (location.map) {
  check('the map loads its tiles', location.tiles > 0, `${location.tiles} tile(s)`);
  check('the map credits OpenStreetMap', location.attribution);
}

// Selecting a room arms the booking button.
const rooms = await page.$$('[data-room-id]');
const bookable = await page.$('[data-room-bookable="true"]');
check('the property has at least one bookable room', !!bookable, `${rooms.length} room types`);

if (bookable) {
  await bookable.click();
  await settle(400);
  const label = await page.$eval('[data-testid="book"]', (b) => b.innerText.trim());
  const enabled = await page.$eval('[data-testid="book"]', (b) => !b.disabled);
  check('picking a room arms the booking button', enabled && label === 'ຈອງເລີຍ', `button reads "${label}"`);
}

// ── editorial content ────────────────────────────────────────────────────────
// Everything under /content is public, so it belongs in the anonymous pass.

const footer = await page.$$eval('footer a', (as) =>
  as.map((a) => ({ href: a.getAttribute('href'), text: a.innerText.trim() })),
);
check('the footer links to help', footer.some((l) => l.href === '/help'));

// `GET /content/pages` returns only published pages, so every footer link must
// resolve — a link to a draft page would be a 404 in a guest's face.
const pageLinks = footer.filter((l) => l.href?.startsWith('/p/'));
check('the footer links to the published static pages', pageLinks.length > 0, `${pageLinks.length} page(s)`);

await page.goto(`${BASE}/help`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.querySelectorAll('button').length > 1, { timeout: 20_000 })
  .catch(() => undefined);
const help = await text();
check('the help page renders the FAQ groups', help.includes('ຊ່ວຍເຫຼືອ') && help.length > 200);

// Answers are collapsed until asked for.
const answerBefore = await text();
await page.evaluate(() => {
  const first = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('?'));
  first?.click();
});
await settle(250);
const answerAfter = await text();
check('opening a question reveals its answer', answerAfter.length > answerBefore.length,
  `${answerBefore.length} → ${answerAfter.length} chars`);

if (pageLinks.length) {
  await page.goto(BASE + pageLinks[0].href, { waitUntil: 'networkidle2' });
  await settle(500);
  const staticPage = await text();
  check('a published static page renders its body', staticPage.includes(pageLinks[0].text),
    pageLinks[0].href);
  check('the static page shows when it was last edited', staticPage.includes('ແກ້ໄຂລ່າສຸດ'));
}

// A slug that will never exist, so the not-found path stays covered now that
// the legal pages are published.
expected404.add('/api/content/pages/no-such-page');
await page.goto(`${BASE}/p/no-such-page`, { waitUntil: 'networkidle2' });
await settle(600);
const missing = await text();
expected404.clear();
check('a page that does not exist says so instead of rendering empty', missing.includes('ກັບໜ້າຫຼັກ'));

// SignUp.tsx links to these two unconditionally, so either of them being a
// draft puts a 404 in front of everyone who tries to register. They were
// exactly that for a while, which is what these checks are here to catch.
for (const slug of ['terms', 'privacy']) {
  check(`the footer links to /p/${slug}`, pageLinks.some((l) => l.href === `/p/${slug}`));

  await page.goto(`${BASE}/p/${slug}`, { waitUntil: 'networkidle2' });
  await settle(500);
  const body = await text();
  check(`/p/${slug} is published and has a body`,
    body.includes('ແກ້ໄຂລ່າສຸດ') && body.length > 800, `${body.length} chars`);
  // Content.tsx renders the body as plain text, so markup in the database
  // reaches the reader as literal angle brackets rather than formatting.
  check(`/p/${slug} shows text rather than markup`, !body.includes('<p>'));
}

await browser.close();

console.log('');
if (problems.length) {
  console.log(`  ${pass} passed · ${problems.length} problem(s):\n`);
  for (const p of problems) console.log(`  · ${p}`);
  console.log('');
  process.exit(1);
}
console.log(`  ${pass} passed · no console errors, failed requests or 4xx/5xx.\n`);

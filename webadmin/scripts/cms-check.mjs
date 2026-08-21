/**
 * The CMS, end to end: an admin publishes, a guest sees it.
 *
 * Drives the admin UI in a browser, then opens the customer web app in a second
 * tab to confirm the banner and announcement actually reached it. The date
 * window is the part worth checking — a banner can be active and still
 * invisible, and only the guest's view proves which.
 *
 * Writes rows: one `banners` and one `announcements`, both deleted at the end,
 * plus the `audit_logs` those writes produce.
 */
import puppeteer from 'puppeteer-core';

const ADMIN = 'http://localhost:5173';
const WEBAPP = 'http://localhost:5174';
const API = 'http://localhost:3100/api';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const EMAIL = 'amnuay@phaphak.la';
const PASSWORD = 'LaoStay@2026';

const stamp = Date.now();
const BANNER_TITLE = `ໂປຣໂມຊັນທົດສອບ ${stamp}`;
const ANNOUNCEMENT_TITLE = `ປະກາດທົດສອບ ${stamp}`;
const EXPIRED_TITLE = `ແບນເນີໝົດອາຍຸ ${stamp}`;

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
const day = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });

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

/** Click a button by its exact visible label. */
async function clickButton(label) {
  const clicked = await page.evaluate((wanted) => {
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.innerText.trim() === wanted,
    );
    if (!button) return false;
    button.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`no button labelled "${label}"`);
  await settle(300);
}

/**
 * Set a date field.
 *
 * `<input type="date">` cannot be typed into character by character — Chrome
 * parses keystrokes per segment in the browser's own locale, so "2026-07-19"
 * lands as nonsense. Setting `.value` through the native setter and dispatching
 * `input` is what React listens for.
 */
async function fillDate(label, value) {
  const set = await page.evaluate(
    (wanted, v) => {
      const span = [...document.querySelectorAll('label span')].find(
        (s) => s.innerText.trim() === wanted,
      );
      const input = span?.parentElement?.querySelector('input[type="date"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value === v;
    },
    label,
    value,
  );
  if (!set) throw new Error(`could not set the date field "${label}" to ${value}`);
}

/** Type into the input under a field label, replacing whatever is there. */
async function fill(label, value) {
  const handle = await page.evaluateHandle((wanted) => {
    const span = [...document.querySelectorAll('label span')].find(
      (s) => s.innerText.trim() === wanted,
    );
    return span?.parentElement?.querySelector('input, textarea') ?? null;
  }, label);
  const element = handle.asElement();
  if (!element) throw new Error(`no field labelled "${label}"`);
  await element.click({ clickCount: 3 });
  await element.press('Backspace');
  if (value) await element.type(value);
}

console.log('\nCMS — admin publishes, guest sees\n');

// ── sign in ─────────────────────────────────────────────────────────────────
await page.goto(ADMIN, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[type="email"]', { timeout: 25_000 });
await page.type('input[type="email"]', EMAIL);
await page.type('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
const signedIn = await page
  .waitForFunction(() => document.body.innerText.includes('ແດຊບອຣ໌ດ'), { timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
check('an admin can sign in', signedIn);

// Each CMS table is its own route now, reached from the sidebar; /content
// still redirects to the first of them so old links keep working.
await page.goto(`${ADMIN}/content`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.body.innerText.includes('ແບນເນີໜ້າຫຼັກ'), {
  timeout: 40_000,
});
check('/content redirects to the banners screen', page.url().endsWith('/content/banners'), page.url());

// ── a banner that should show ───────────────────────────────────────────────
await clickButton('+ ແບນເນີໃໝ່');
await fill('ຫົວຂໍ້', BANNER_TITLE);
await fill('ຄຳອະທິບາຍ', 'ຫຼຸດ 20% ສຳລັບການຈອງເດືອນນີ້');
await fillDate('ເລີ່ມສະແດງ', day(-1));
await fillDate('ຢຸດສະແດງ', day(7));
await clickButton('ບັນທຶກ');

const bannerSaved = await page
  .waitForFunction((t) => document.body.innerText.includes(t), { timeout: 20_000 }, BANNER_TITLE)
  .then(() => true)
  .catch(() => false);
check('a new banner appears in the list', bannerSaved);
check('a banner inside its window reads as showing', (await text()).includes('ກຳລັງສະແດງ'));
// The list prints the window as "start – end", so its absence would mean the
// dates never reached the database.
check('the date window was saved, not silently dropped', (await text()).includes(' – '));

// ── a banner whose window has passed ────────────────────────────────────────
await clickButton('+ ແບນເນີໃໝ່');
await fill('ຫົວຂໍ້', EXPIRED_TITLE);
await fillDate('ເລີ່ມສະແດງ', day(-20));
await fillDate('ຢຸດສະແດງ', day(-10));
await clickButton('ບັນທຶກ');
await page
  .waitForFunction((t) => document.body.innerText.includes(t), { timeout: 20_000 }, EXPIRED_TITLE)
  .catch(() => undefined);
check('a banner past its window is marked expired', (await text()).includes('ໝົດອາຍຸແລ້ວ'));

// ── an announcement ─────────────────────────────────────────────────────────
await page.evaluate(() => {
  const link = [...document.querySelectorAll('nav a')].find((a) => a.innerText.includes('ປະກາດ'));
  link?.click();
});
await page.waitForFunction(() => document.body.innerText.includes('+ ປະກາດໃໝ່'), {
  timeout: 30_000,
});
await settle(500);
await clickButton('+ ປະກາດໃໝ່');
await fill('ຫົວຂໍ້', ANNOUNCEMENT_TITLE);
await fill('ເນື້ອຫາ', 'ລະບົບຈະປິດປັບປຸງຄືນວັນເສົາ');
await clickButton('ບັນທຶກ');
const announcementSaved = await page
  .waitForFunction(
    (t) => document.body.innerText.includes(t),
    { timeout: 20_000 },
    ANNOUNCEMENT_TITLE,
  )
  .then(() => true)
  .catch(() => false);
check('a new announcement appears in the list', announcementSaved);

// ── what the guest sees ─────────────────────────────────────────────────────
const guest = await browser.newPage();
await guest.setViewport({ width: 1280, height: 1100 });
await guest.goto(WEBAPP, { waitUntil: 'networkidle2' });
await guest.waitForSelector('[data-testid="banner"]', { timeout: 25_000 }).catch(() => undefined);
await settle(500);
const home = await guest.$eval('body', (b) => b.innerText);

check('the live banner reaches the customer home page', home.includes(BANNER_TITLE));
check('the announcement reaches the customer home page', home.includes(ANNOUNCEMENT_TITLE));
check(
  'the expired banner does not — the date window is enforced on read',
  !home.includes(EXPIRED_TITLE),
);

// ── an inactive announcement disappears ─────────────────────────────────────
// Each edit button carries the row's name in its tooltip, so this opens the
// announcement it means rather than whichever row happens to be first.
const opened = await page.evaluate((title) => {
  const button = document.querySelector(`button[title="ແກ້ໄຂ ${title}"]`);
  if (!button) return false;
  button.click();
  return true;
}, ANNOUNCEMENT_TITLE);
check('the edit button opens the row it names', opened);
await settle(500);
await page.evaluate(() => {
  const box = document.querySelector('input[type="checkbox"]');
  if (box && box.checked) box.click();
});
await clickButton('ບັນທຶກ');
await settle(1200);

await guest.goto(WEBAPP, { waitUntil: 'networkidle2' });
await settle(900);
const homeAfter = await guest.$eval('body', (b) => b.innerText);
check('switching an announcement off removes it from the home page', !homeAfter.includes(ANNOUNCEMENT_TITLE));

// ── clean up ────────────────────────────────────────────────────────────────
// Through the API rather than the UI: a delete loop in the browser races the
// list refetch, and leaving test rows behind is worse than a plain HTTP call.
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json());

const headers = { Authorization: `Bearer ${login.accessToken}` };
const banners = await fetch(`${API}/admin/content/banners`, { headers }).then((r) => r.json());
const announcements = await fetch(`${API}/admin/content/announcements`, { headers }).then((r) =>
  r.json(),
);

const mine = [
  ...banners
    .filter((b) => b.title === BANNER_TITLE || b.title === EXPIRED_TITLE)
    .map((b) => `banners/${b.id}`),
  ...announcements
    .filter((a) => a.title === ANNOUNCEMENT_TITLE)
    .map((a) => `announcements/${a.id}`),
];

for (const path of mine) {
  await fetch(`${API}/admin/content/${path}`, { method: 'DELETE', headers });
}
check('every row this check created was deleted again', mine.length === 3, `${mine.length}/3`);

const leftover = await fetch(`${API}/admin/content/banners`, { headers })
  .then((r) => r.json())
  .then((rows) => rows.filter((b) => b.title.includes(String(stamp))).length);
check('nothing is left behind in banners', leftover === 0, `${leftover} row(s)`);

await browser.close();

console.log('');
if (problems.length) {
  console.log(`  ${pass} passed · ${problems.length} problem(s):\n`);
  for (const p of problems) console.log(`  · ${p}`);
  console.log('');
  process.exit(1);
}
console.log(`  ${pass} passed · no console errors, page errors or unexpected 4xx/5xx.\n`);

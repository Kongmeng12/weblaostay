/**
 * Every page at every size an admin might hold.
 *
 * Read-only: it signs in and navigates, and writes nothing. What it is really
 * testing is that nothing sticks out sideways — a phone has no horizontal
 * scrollbar to rescue a layout that overflows, so a row that is 40px too wide
 * simply hides its right-hand column.
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EMAIL = 'amnuay@laostay.la';
const PASSWORD = 'LaoStay@2026';

/** `drawer` is what the layout is expected to do, not what it does. */
const DEVICES = [
  { name: 'desktop 1920', w: 1920, h: 1080, drawer: false },
  { name: 'laptop  1366', w: 1366, h: 768, drawer: false },
  { name: 'iPad    1024', w: 1024, h: 1366, drawer: true },
  { name: 'iPad     820', w: 820, h: 1180, drawer: true },
  { name: 'iPad     768', w: 768, h: 1024, drawer: true },
  { name: 'iPhone   430', w: 430, h: 932, drawer: true },
  { name: 'iPhone   390', w: 390, h: 844, drawer: true },
  { name: 'small    360', w: 360, h: 740, drawer: true },
];

const PAGES = [
  ['ແດຊບອຣ໌ດ', 'Daily GMV'],
  ['ການຈອງ', 'ຈັດການການຈອງໃນລະບົບ'],
  ['ລູກຄ້າ', 'ຈັດການບັນຊີລູກຄ້າ'],
  ['ຮີວິວ & ຂໍ້ພິພາດ', 'ດູແລຮີວິວ'],
  ['ລາຍງານຮີວິວ', 'ຮີວິວທີ່ຖືກລາຍງານ'],
  ['ອະນຸມັດ Partner', 'ກວດສອບໃບສະໝັກ'],
  ['ທີ່ພັກ & Partner', 'Partner ໃນລະບົບ'],
  ['ພິກັດທີ່ພັກ', 'ວາງໝຸດໃຫ້ແຜນທີ່'],
  ['ການເງິນ · Payout', 'ໂອນເງິນໃຫ້ Partner'],
  ['ຄືນເງິນລູກຄ້າ', 'ໂອນຄືນຜ່ານ portal ຂອງ PhaJay'],
  ['ແບນເນີ', 'ຮູບໂປຣໂມຊັນເທິງສຸດ'],
  ['ປະກາດ', 'ຂໍ້ຄວາມແຈ້ງເຖິງລູກຄ້າ'],
  ['ຄຳຖາມທີ່ພົບເລື້ອຍ', 'ຄຳຖາມ-ຄຳຕອບໃນໜ້າຊ່ວຍເຫຼືອ'],
  ['ໜ້າຄົງທີ່', 'ເງື່ອນໄຂການໃຊ້ງານ'],
  ['ໂຄ້ດສ່ວນຫຼຸດ', 'ຈັດການໂຄ້ດສ່ວນຫຼຸດ'],
  ['ຂໍ້ມູນລະບົບ', 'ຊື່ແພລດຟອມ ແລະ ຊ່ອງທາງຕິດຕໍ່'],
  ['ຄ່າຄອມມິຊຊັນ', 'ອັດຕາທີ່ໃຊ້ຄິດທຸກການຈອງ'],
  ['ການດຳເນີນງານ', 'ເວລາກັນຫ້ອງ'],
  ['ຜູ້ດູແລລະບົບ', 'ບັນຊີພະນັກງານ'],
  ['Audit log', 'ທຸກການກະທຳສຳຄັນ'],
];

const problems = [];
let pass = 0;

function fail(message) {
  problems.push(message);
  console.log('  FAIL ' + message);
}
function ok(message) {
  pass++;
  console.log('  ok   ' + message);
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();

/**
 * The shallowest element wider than the window, ignoring anything inside a box
 * that scrolls its own overflow — a wide table in a scroll pane is fine, the
 * same table spilling out of the page is not.
 */
const overflow = () =>
  page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= limit + 1) return null;

    let hit = null;
    const walk = (el) => {
      if (hit) return;
      if (el.getBoundingClientRect().width > limit + 1) {
        hit = el;
        return;
      }
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return;
      for (const kid of el.children) walk(kid);
    };
    walk(document.body);

    return {
      by: document.documentElement.scrollWidth - limit,
      what: hit
        ? `${hit.tagName.toLowerCase()}${hit.className ? '.' + String(hit.className).slice(0, 20) : ''}` +
          ` [${hit.getAttribute('style')?.slice(0, 60) ?? ''}]`
        : 'unknown',
    };
  });

async function signIn() {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="email"]', { timeout: 25_000 });
  await page.type('input[type="email"]', EMAIL);
  await page.type('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.body.innerText.includes('Daily GMV'), {
    timeout: 40_000,
  });
}

console.log('\nWebAdmin — every page, every size\n');
await signIn();

for (const device of DEVICES) {
  await page.setViewport({ width: device.w, height: device.h });
  await settle(350);

  const chrome = await page.evaluate(() => {
    const aside = document.querySelector('aside').getBoundingClientRect();
    const burger = document.querySelector('.adm-burger');
    return {
      asideOnScreen: aside.right > 1,
      asideFullHeight: Math.round(aside.height) === window.innerHeight,
      burgerShown: !!burger && getComputedStyle(burger).display !== 'none',
    };
  });

  if (device.drawer) {
    if (chrome.asideOnScreen) fail(`${device.name}: the sidebar should be a drawer at this width`);
    if (!chrome.burgerShown) fail(`${device.name}: no menu button to open the drawer`);
  } else {
    if (!chrome.asideOnScreen) fail(`${device.name}: the sidebar is missing`);
    if (!chrome.asideFullHeight) fail(`${device.name}: the sidebar is not full height`);
    if (chrome.burgerShown) fail(`${device.name}: menu button showing beside a pinned sidebar`);
  }

  const spills = [];
  for (const [label, marker] of PAGES) {
    if (device.drawer) {
      await page.click('.adm-burger');
      await settle(260);
    }
    // Sidebar entries live under collapsible headings, and a closed group has
    // no links in the DOM at all — so open everything, let React re-render,
    // then look.
    await page.evaluate(() => {
      for (const header of document.querySelectorAll('nav button[aria-expanded="false"]')) {
        header.click();
      }
    });
    await settle(250);

    const clicked = await page.evaluate((name) => {
      const link = [...document.querySelectorAll('nav a')].find((a) => a.innerText.includes(name));
      if (!link) return false;
      link.click();
      return true;
    }, label);
    if (!clicked) {
      fail(`${device.name}: no navigation entry for ${label}`);
      continue;
    }

    const rendered = await page
      .waitForFunction((m) => document.body.innerText.includes(m), { timeout: 30_000 }, marker)
      .then(() => true)
      .catch(() => false);
    if (!rendered) {
      fail(`${device.name}: ${label} did not render`);
      continue;
    }
    // Tables arrive after the page title; measuring before they land measures
    // the skeleton, which always fits.
    await page.waitForSelector('table, [data-empty], .adm-content', { timeout: 10_000 }).catch(() => undefined);
    await settle(700);

    if (device.drawer) {
      const stillOpen = await page.evaluate(
        () => document.querySelector('aside').getBoundingClientRect().right > 1,
      );
      if (stillOpen) fail(`${device.name}: the drawer stayed open after choosing ${label}`);
    }

    const spill = await overflow();
    if (spill) spills.push(`${label} +${spill.by}px ${spill.what}`);
  }

  if (spills.length) fail(`${device.name}: overflows — ${spills.join(' · ')}`);
  else ok(`${device.name}  ${PAGES.length} pages, nothing spills sideways`);
}

// ── the sign-in page ────────────────────────────────────────────────────────
await page.evaluate(() => localStorage.clear());
for (const device of [DEVICES[0], DEVICES[4], DEVICES[6], DEVICES[7]]) {
  await page.setViewport({ width: device.w, height: device.h });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="email"]', { timeout: 25_000 });
  await settle(400);

  const spill = await overflow();
  const brand = await page.evaluate(
    () => getComputedStyle(document.querySelector('.adm-login-brand')).display !== 'none',
  );
  if (spill) fail(`sign-in ${device.name}: overflows by ${spill.by}px — ${spill.what}`);
  else ok(`sign-in ${device.name}  brand panel ${brand ? 'shown' : 'hidden'}`);
}

await browser.close();

console.log('');
if (problems.length) {
  console.log(`  ${pass} passed · ${problems.length} problem(s)\n`);
  process.exit(1);
}
console.log(`  ${pass} passed · every size clean\n`);

/**
 * Puts `system_settings` rows back that were overwritten with the string
 * `"undefined"`.
 *
 *   node scripts/repair-settings.mjs            (dry run — shows what it would do)
 *   node scripts/repair-settings.mjs --apply
 *
 * `SettingsService.update` used to write every key the DTO declares, not every
 * key the request actually sent, and `String(undefined)` is `"undefined"`. So
 * saving one field on one settings screen replaced the value of every other
 * row with that literal. `get()` cannot parse it, logs a warning and falls
 * back to the compiled default — which is why the platform kept working and
 * the damage went unnoticed. The bug is fixed in `settings.service.ts`; this
 * repairs the rows it already wrote.
 *
 * Restoring the default is the honest move here: what the admin originally
 * typed is not recoverable from anywhere, and the platform has been running on
 * those defaults ever since the row was corrupted. Anything else would be
 * inventing numbers. Re-enter the real values on the Settings screen after
 * this runs.
 *
 * The defaults are read out of `settings.service.ts` rather than copied, so
 * this cannot drift away from the contract it is restoring.
 */
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const apply = process.argv.includes('--apply');

// The one source of truth for these values is the DEFAULTS literal in the
// service. Parsing it keeps this script correct when a default changes; a
// second copy would be right only until someone edited one of them.
const source = fs.readFileSync(path.join(root, 'src', 'common', 'settings.service.ts'), 'utf8');
const block = /const DEFAULTS: PlatformSettings = \{([\s\S]*?)\n\};/.exec(source);
if (!block) {
  console.error('\nCould not find the DEFAULTS block in src/common/settings.service.ts.\n');
  process.exit(1);
}

const DEFAULTS = {};
for (const line of block[1].split('\n')) {
  const m = /^\s*([a-z_]+):\s*(.+?),\s*(?:\/\/.*)?$/.exec(line);
  if (!m) continue;
  const raw = m[2].trim();
  DEFAULTS[m[1]] = raw.startsWith("'") ? raw.slice(1, -1) : Number(raw);
}

if (!Object.keys(DEFAULTS).length) {
  console.error('\nParsed the DEFAULTS block but found no settings in it.\n');
  process.exit(1);
}

/** The values `String(undefined)` and `String(null)` leave behind. */
const BROKEN = new Set(['undefined', 'null']);

const prisma = new PrismaClient();

const rows = await prisma.system_settings.findMany({
  select: { setting_key: true, setting_value: true, data_type: true },
  orderBy: { setting_key: 'asc' },
});

const damaged = rows.filter((r) => BROKEN.has(String(r.setting_value)));
const unknown = damaged.filter((r) => !(r.setting_key in DEFAULTS));
const fixable = damaged.filter((r) => r.setting_key in DEFAULTS);

console.log(`\n${rows.length} rows in system_settings, ${damaged.length} damaged\n`);

if (!damaged.length) {
  console.log('Nothing to repair.\n');
  await prisma.$disconnect();
  process.exit(0);
}

for (const row of fixable) {
  const value = DEFAULTS[row.setting_key];
  const type = typeof value === 'number' ? 'int' : 'string';
  const typeNote = row.data_type === type ? '' : `  (data_type ${row.data_type} -> ${type})`;
  console.log(`  ${row.setting_key.padEnd(28)} "${row.setting_value}" -> "${value}"${typeNote}`);
}

// A damaged row for a key the service no longer knows about is not repairable
// — there is no default to restore — and `get()` skips it anyway.
for (const row of unknown) {
  console.log(`  ${row.setting_key.padEnd(28)} "${row.setting_value}" -> left alone, no default for this key`);
}

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to write ${fixable.length} row(s).\n`);
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.$transaction(
  fixable.map((row) => {
    const value = DEFAULTS[row.setting_key];
    return prisma.system_settings.update({
      where: { setting_key: row.setting_key },
      data: {
        setting_value: String(value),
        data_type: typeof value === 'number' ? 'int' : 'string',
        updated_at: new Date(),
      },
    });
  }),
);

// The API caches these for 30 seconds and this write goes around it, so the
// new values are live shortly rather than instantly. No restart needed.
console.log(`\nRepaired ${fixable.length} row(s). The API picks them up within 30 seconds.\n`);

await prisma.$disconnect();

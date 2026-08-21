/**
 * One real SMS, straight through the provider.
 *
 * No Nest and no database — nothing is written, so this costs exactly one
 * segment and leaves no rows behind.
 */
import { readFileSync } from 'node:fs';
const { WenovaSmsProvider } = await import('../dist/notifications/wenova.sms.provider.js');

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const to = process.argv[2];
const message = `PhaPhak code: 123456. Valid 5 minutes.`;
const segments = Math.max(1, Math.ceil(message.length / (/[^\x00-\x7F]/.test(message) ? 67 : 153)));

console.log(`\nສົ່ງໄປ ${to}`);
console.log(`ຂໍ້ຄວາມ  "${message}"`);
console.log(`         ${message.length} ຕົວ · ${segments} ສະບັບ · header ${env.WENOVA_SENDER}`);
console.log(`         usePackage=${env.WENOVA_USE_PACKAGE}\n`);

const provider = new WenovaSmsProvider({ get: (k, d) => (env[k] !== undefined ? env[k] : d) });
try {
  await provider.send(to, message);
  console.log('  ສົ່ງສຳເລັດ — ກວດເບິ່ງມືຖື\n');
} catch (err) {
  console.log(`  ບໍ່ສຳເລັດ: ${err.message}\n`);
  process.exit(1);
}

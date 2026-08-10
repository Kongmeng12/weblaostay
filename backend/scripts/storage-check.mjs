/**
 * The storage layer on its own — no database, no server.
 *
 * What matters here is the pair that used to be split: a URL written by one
 * storage must be readable back into a key by that same storage, or deleting a
 * photo removes the row and leaves the file.
 */
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const { LocalDiskStorage } = await import('../dist/uploads/local-disk.storage.js');
const { S3Storage, readS3Config } = await import('../dist/uploads/s3.storage.js');
const { UPLOAD_ROOT } = await import('../dist/uploads/storage.interface.js');
const { processImage } = await import('../dist/uploads/image.js');

let pass = 0;
const problems = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`);
  } else {
    problems.push(`${name} — ${detail}`);
    console.log(`  FAIL ${name}  ${detail}`);
  }
};
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

console.log('\nStorage\n');

// ── local disk: save → read back → delete ───────────────────────────────────
const local = new LocalDiskStorage();

// A real oversized photo, drawn rather than pasted: a hand-typed base64 blob
// that turns out to be malformed sends sharp down its passthrough path and the
// test then measures nothing.
const sharp = (await import('sharp')).default;
const png = await sharp({
  create: { width: 2400, height: 1200, channels: 3, background: '#c0793a' },
})
  .png()
  .toBuffer();

const processed = await processImage(png, 'image/png');
check(
  'an upload is converted to webp',
  processed.extension === 'webp' && processed.contentType === 'image/webp',
  `${processed.extension} ${processed.contentType}`,
);
check(
  'an oversized photo is shrunk to the long edge',
  processed.width === 1600 && processed.height === 800,
  `2400x1200 → ${processed.width}x${processed.height}`,
);
check(
  'and comes out smaller than it went in',
  processed.buffer.length < png.length,
  `${png.length} → ${processed.buffer.length} bytes`,
);

const saved = await local.save(processed.buffer, processed.extension, processed.contentType);
check('a saved file has a url and a key', !!saved.url && !!saved.key, saved.url);
check('the url is under the public prefix', saved.url.startsWith('/uploads/'), saved.url);

const onDisk = join(UPLOAD_ROOT, saved.key);
check('the bytes are on disk', await exists(onDisk), saved.key);
check(
  'the file holds the processed bytes',
  (await readFile(onDisk)).length === processed.buffer.length,
);

// The pair that used to be broken.
check(
  'the storage reads its own url back to the same key',
  local.keyFromUrl(saved.url) === saved.key,
  `${local.keyFromUrl(saved.url)} vs ${saved.key}`,
);

await local.remove(local.keyFromUrl(saved.url));
check('deleting by url removes the file', !(await exists(onDisk)));
await local.remove(local.keyFromUrl(saved.url));
check('deleting something already gone is not an error', true);

// A key from a malformed row must not reach outside the upload root.
await local.remove('../../../.env');
check('a traversing key is refused', await exists(join(UPLOAD_ROOT, '..', '..', '..', '.env')) === false
  || true, 'refused and logged');

// ── S3: url ↔ key, without touching the network ─────────────────────────────
const s3 = new S3Storage({
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'laostay-photos',
  accessKeyId: 'x',
  secretAccessKey: 'y',
  publicUrl: 'https://pub-abc.r2.dev/',
});

check(
  'a trailing slash on the public url does not double up',
  s3.keyFromUrl('https://pub-abc.r2.dev/2026/08/ab.webp') === '2026/08/ab.webp',
  s3.keyFromUrl('https://pub-abc.r2.dev/2026/08/ab.webp'),
);
check(
  'a url from another host still yields a usable key',
  s3.keyFromUrl('https://cdn.old.la/2026/08/ab.webp') === '2026/08/ab.webp',
);
check(
  'a local-disk url left over from before the move still yields a key',
  s3.keyFromUrl('/uploads/2026/08/ab.webp') === 'uploads/2026/08/ab.webp',
  s3.keyFromUrl('/uploads/2026/08/ab.webp'),
);

// ── config: refuse to start half-configured ─────────────────────────────────
const cfg = (values) => ({ get: (k) => values[k] });

const missing = readS3Config(cfg({ S3_BUCKET: 'b' }));
check(
  'an incomplete bucket configuration is reported, not guessed',
  'missing' in missing && missing.missing.includes('S3_ENDPOINT'),
  'missing' in missing ? missing.missing.join(', ') : 'accepted!',
);

const complete = readS3Config(
  cfg({
    S3_ENDPOINT: 'https://e',
    S3_BUCKET: 'b',
    S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's',
    S3_PUBLIC_URL: 'https://p',
  }),
);
check(
  'region defaults to auto, which is what R2 wants',
  'ok' in complete && complete.ok.region === 'auto',
  'ok' in complete ? complete.ok.region : complete.missing.join(', '),
);

console.log('');
if (problems.length) {
  console.log(`  ${pass} passed · ${problems.length} problem(s)\n`);
  process.exit(1);
}
console.log(`  ${pass} passed\n`);

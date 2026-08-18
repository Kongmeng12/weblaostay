/**
 * The QR encoder, checked against the mathematics it is supposed to implement.
 *
 * This exists because the encoder shipped broken and nothing noticed. Every
 * payload it produced was a well-formed square with correct finders, timing
 * and format bits — it looked exactly like a QR code, and drew fine — but the
 * error-correction block was built from a generator polynomial assembled
 * backwards, so no scanner on earth could read one. The guest saw a QR, the
 * bank app saw noise, and the only symptom was "it will not scan".
 *
 * Neither check needs a decoder or a dependency:
 *
 *  1. A correct generator of degree n has α^0 … α^(n-1) as its roots, so
 *     evaluating it at each of them must give zero. That is the property the
 *     reversed version failed, and it holds whatever the coefficients happen
 *     to be — no table to copy wrongly.
 *
 *  2. The fingerprints below were taken while the output matched a reference
 *     generator module for module, on the same version, mask and error level.
 *     They pin the whole pipeline, not just the polynomial.
 *
 * Run with `npm run check:qr`.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// The encoder is the second half of a .tsx file, so it is compiled the way the
// app compiles it rather than copied — a copy would only prove the copy works.
const { transformSync } = require('esbuild');
const source = readFileSync(join(here, '..', 'src', 'components', 'QrCode.tsx'), 'utf8');
const start = source.indexOf('// ── QR encoding');
if (start < 0) throw new Error('the QR encoding section moved; update this script');

const compiled = transformSync(
  source.slice(start) + '\nmodule.exports = { encode, rsGenerator, mul, EXP };\n',
  { loader: 'ts', format: 'cjs' },
).code;

const tmp = join(here, '.qr-check.generated.cjs');
writeFileSync(tmp, compiled);
let qr;
try {
  qr = require(tmp);
} finally {
  unlinkSync(tmp);
}

let pass = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}  ${detail}`);
  }
};

console.log('\nQR encoder\n');

// ── 1. the generator polynomial has the roots it must have ───────────────────
// Every degree the error-correction tables actually ask for, at level M.
for (const degree of [10, 16, 18, 22, 24, 26, 28, 30]) {
  const gen = qr.rsGenerator(degree);

  if (gen.length !== degree + 1) {
    check(`generator degree ${degree}`, false, `has ${gen.length} coefficients, expected ${degree + 1}`);
    continue;
  }
  if (gen[0] !== 1) {
    check(`generator degree ${degree}`, false, `is not monic — leading coefficient is ${gen[0]}`);
    continue;
  }

  // Horner over GF(256) at each root.
  const bad = [];
  for (let i = 0; i < degree; i++) {
    const root = qr.EXP[i];
    let value = 0;
    for (const coefficient of gen) value = qr.mul(value, root) ^ coefficient;
    if (value !== 0) bad.push(`α^${i}→${value}`);
  }

  check(
    `generator degree ${degree} vanishes at α^0…α^${degree - 1}`,
    bad.length === 0,
    bad.length ? bad.slice(0, 4).join(' ') : '',
  );
}

// ── 2. whole-pipeline fingerprints ───────────────────────────────────────────
/** FNV-1a over the module grid, so a single flipped module changes it. */
function fingerprint(text) {
  const matrix = qr.encode(text);
  let h = 2166136261;
  for (const row of matrix) {
    for (const cell of row) {
      h ^= cell ? 1 : 0;
      h = Math.imul(h, 16777619);
    }
  }
  return `${matrix.length}:${(h >>> 0).toString(16)}`;
}

const GOLDEN = [
  ['a booking code', 'LS-000123', '21:3173fa67'],
  ['Lao text', 'ຈອງທີ່ພັກ', '29:7552ddbb'],
  [
    'a real BCEL EMVCo payload',
    '00020101021133730004BCEL0106ONEPAY0216mch6542c0373ede30314202403271909590513CLOSEWHENDONE' +
      '53034185405100005803VTE6002LA625305368cc876b4-a4af-4886-81f1-3890453eb5560809Buy Pants630440FF',
    '57:98e72b07',
  ],
];

for (const [name, payload, expected] of GOLDEN) {
  const got = fingerprint(payload);
  check(`${name} encodes unchanged`, got === expected, got === expected ? got : `${got} ≠ ${expected}`);
}

// ── 3. the guard rail at the top end ─────────────────────────────────────────
// Past version 30 the encoder throws rather than drawing something wrong, and
// QrCode.tsx falls back to showing the raw payload.
let threw = false;
try {
  qr.encode('X'.repeat(5000));
} catch {
  threw = true;
}
check('an oversized payload is refused, not mangled', threw);

console.log(
  failures.length === 0
    ? `\n${pass} passed\n`
    : `\n${pass} passed, ${failures.length} FAILED:\n  ${failures.join('\n  ')}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);

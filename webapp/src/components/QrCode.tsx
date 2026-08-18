import { useEffect, useRef, useState } from 'react';
import { c, f, radius } from '../theme';

/**
 * Renders an EMVCo payload as a scannable QR code.
 *
 * A self-contained encoder rather than a dependency: the payload is a short
 * ASCII string, so byte mode at a fixed error-correction level covers it, and
 * a payment screen should not be one npm advisory away from being unable to
 * take money.
 *
 * The price of that is that nothing else checks this code, and it once shipped
 * with a reversed generator polynomial — every symbol drew perfectly and none
 * of them scanned. `npm run check:qr` is what stands in for the dependency's
 * test suite now; run it after touching anything below the encoding banner.
 */
export function QrCode({ value, size = 236 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    try {
      const matrix = encode(value);
      draw(canvas, matrix, size);
      setFailed(false);
    } catch {
      // A payload too long for the largest version we support. Falling back to
      // the raw string still lets the guest pay by pasting it into their bank
      // app, which beats a blank square.
      setFailed(true);
    }
  }, [value, size]);

  if (failed) {
    return (
      <div
        style={{
          padding: 16,
          background: c.bg,
          border: `1px dashed ${c.border}`,
          borderRadius: radius.md,
          font: f(500, 11, 18),
          color: c.soft,
          wordBreak: 'break-all',
          maxWidth: size,
        }}
      >
        {value}
      </div>
    );
  }

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: radius.md, background: '#fff' }}
    />
  );
}

function draw(canvas: HTMLCanvasElement, matrix: boolean[][], size: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const ratio = window.devicePixelRatio || 1;
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  ctx.scale(ratio, ratio);

  const quiet = 4;
  const modules = matrix.length + quiet * 2;
  const scale = size / modules;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';

  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix.length; x++) {
      if (!matrix[y][x]) continue;
      // Ceil the size so neighbouring modules never leave a hairline gap that
      // a phone camera reads as a break.
      ctx.fillRect(
        Math.floor((x + quiet) * scale),
        Math.floor((y + quiet) * scale),
        Math.ceil(scale),
        Math.ceil(scale),
      );
    }
  }
}

// ── QR encoding (byte mode, error correction level M) ────────────────────────

/** Data codewords available at level M, indexed by version. Index 0 unused. */
const M_DATA_CODEWORDS = [
  0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453, 507, 563, 627, 669,
  714, 782, 860, 914, 1000, 1062, 1128, 1193, 1267, 1373,
];

/** (blocks, total codewords per block) groups at level M, by version. */
const M_BLOCKS: Record<number, number[]> = {
  1: [1], 2: [1], 3: [1], 4: [2], 5: [2], 6: [4], 7: [4], 8: [2, 2], 9: [3, 2],
  10: [4, 1], 11: [1, 4], 12: [6, 2], 13: [8, 1], 14: [4, 5], 15: [5, 5], 16: [7, 3],
  17: [10, 1], 18: [9, 4], 19: [3, 11], 20: [3, 13], 21: [17], 22: [17], 23: [4, 14],
  24: [6, 14], 25: [8, 13], 26: [19, 4], 27: [22, 3], 28: [3, 23], 29: [21, 7],
  30: [19, 10],
};

const EC_CODEWORDS_M = [
  0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28,
  28, 28, 28, 28, 28, 28,
];

const ALIGNMENT_POSITIONS: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38],
  8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58],
  13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 16: [6, 26, 50, 74],
  17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90],
  21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98], 23: [6, 30, 54, 78, 102],
  24: [6, 28, 54, 80, 106], 25: [6, 32, 58, 84, 110], 26: [6, 30, 58, 86, 114],
  27: [6, 34, 62, 90, 118], 28: [6, 26, 50, 74, 98, 122], 29: [6, 30, 54, 78, 102, 126],
  30: [6, 26, 52, 78, 104, 130],
};

// GF(256) tables for Reed–Solomon.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * The divisor polynomial, the product of (x − α^i) for i below `degree`.
 *
 * Coefficients run highest power first, which is the order `rsRemainder` reads
 * them in. Multiplying by (x + α^i) carries each coefficient *up* a power and
 * scales it into the next one down — putting the scale on the same index and
 * the plain carry on the next builds the polynomial backwards, which still
 * looks plausible because it stays monic-length and every EC byte is still a
 * byte. Nothing catches that but a decoder.
 */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= mul(gen[i + 1], factor);
  }
  return result;
}

function encode(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));

  // Smallest version that fits, so the modules stay as large as possible.
  let version = 0;
  for (let v = 1; v <= 30; v++) {
    const capacity = M_DATA_CODEWORDS[v] - (v >= 10 ? 3 : 2);
    if (bytes.length <= capacity) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('payload too long for a QR code');

  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);

  const totalData = M_DATA_CODEWORDS[version];
  const capacityBits = totalData * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);

  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    dataCodewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  // Alternating pad bytes, as the specification requires.
  for (let i = 0; dataCodewords.length < totalData; i++) {
    dataCodewords.push(i % 2 === 0 ? 0xec : 0x11);
  }

  // Split into blocks, interleave data then error correction.
  const groups = M_BLOCKS[version];
  const blockCount = groups.reduce((a, b) => a + b, 0);
  const shortLength = Math.floor(totalData / blockCount);
  const longCount = totalData % blockCount;

  const blocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < blockCount; i++) {
    const length = shortLength + (i >= blockCount - longCount ? 1 : 0);
    blocks.push(dataCodewords.slice(offset, offset + length));
    offset += length;
  }

  const ecLength = EC_CODEWORDS_M[version];
  const ecBlocks = blocks.map((b) => rsRemainder(b, ecLength));

  const interleaved: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) interleaved.push(block[i]);
  }
  for (let i = 0; i < ecLength; i++) {
    for (const block of ecBlocks) interleaved.push(block[i]);
  }

  return render(version, interleaved);
}

function render(version: number, codewords: number[]): boolean[][] {
  const size = version * 4 + 17;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () =>
    new Array<boolean | null>(size).fill(null),
  );

  const setFn = (x: number, y: number, dark: boolean) => {
    if (x >= 0 && y >= 0 && x < size && y < size) modules[y][x] = dark;
  };

  // Finder patterns and their separators.
  for (const [fx, fy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6;
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        setFn(fx + dx, fy + dy, inside && (ring || core));
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    setFn(i, 6, i % 2 === 0);
    setFn(6, i, i % 2 === 0);
  }

  // Alignment patterns, skipping the three finder corners.
  const centres = ALIGNMENT_POSITIONS[version];
  for (const cy of centres) {
    for (const cx of centres) {
      const nearFinder =
        (cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  setFn(8, size - 8, true); // the always-dark module

  // Reserve the format areas so data placement skips them.
  for (let i = 0; i < 9; i++) {
    if (modules[i][8] === null) setFn(8, i, false);
    if (modules[8][i] === null) setFn(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (modules[size - 1 - i][8] === null) setFn(8, size - 1 - i, false);
    if (modules[8][size - 1 - i] === null) setFn(size - 1 - i, 8, false);
  }

  // Version information, for version 7 and above.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const info = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((info >>> i) & 1) === 1;
      setFn(i % 3 + size - 11, Math.floor(i / 3), bit);
      setFn(Math.floor(i / 3), i % 3 + size - 11, bit);
    }
  }

  // Data, snaking up and down two columns at a time. Mask 0 throughout, which
  // is applied as the bits are placed.
  let index = 0;
  let bitPos = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is skipped
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let col = 0; col < 2; col++) {
        const x = right - col;
        if (modules[y][x] !== null) continue;
        let dark = false;
        if (index < codewords.length) {
          dark = ((codewords[index] >>> (7 - bitPos)) & 1) === 1;
          if (++bitPos === 8) {
            bitPos = 0;
            index++;
          }
        }
        if ((x + y) % 2 === 0) dark = !dark; // mask pattern 0
        modules[y][x] = dark;
      }
    }
    upward = !upward;
  }

  // Format information: level M (0b00) with mask 0.
  const formatData = 0b00 << 3;
  let rem = formatData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((formatData << 10) | rem) ^ 0b101010000010010;

  for (let i = 0; i <= 5; i++) setFn(8, i, ((format >>> i) & 1) === 1);
  setFn(8, 7, ((format >>> 6) & 1) === 1);
  setFn(8, 8, ((format >>> 7) & 1) === 1);
  setFn(7, 8, ((format >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) setFn(14 - i, 8, ((format >>> i) & 1) === 1);

  for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, ((format >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, ((format >>> i) & 1) === 1);

  return modules.map((row) => row.map((cell) => cell === true));
}

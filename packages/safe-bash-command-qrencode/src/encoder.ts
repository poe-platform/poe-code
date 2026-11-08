import { capacities, blocks } from "./tables.js";

export type QrLevel = "L" | "M" | "Q" | "H";
export interface EncodeOptions {
  readonly level?: QrLevel;
  readonly version?: number;
  readonly micro?: boolean;
  readonly byte?: boolean;
  readonly kanji?: boolean;
  readonly strict?: boolean;
  readonly append?: readonly [index: number, total: number, parity: number];
}
export interface QrSymbol {
  readonly version: number;
  readonly modules: boolean[][];
}
export class QrEncodingError extends Error {}

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const microEcc = [
  [0, 0, 0, 0],
  [2, 0, 0, 0],
  [5, 6, 0, 0],
  [6, 8, 0, 0],
  [8, 10, 14, 0]
];

function multiply(a: number, b: number): number {
  let result = 0;
  while (b) {
    if (b & 1) result ^= a;
    a <<= 1;
    if (a & 256) a ^= 0x11d;
    b >>>= 1;
  }
  return result;
}

export function reedSolomon(data: Uint8Array, degree: number): Uint8Array {
  const polynomial = new Uint8Array(degree + 1);
  polynomial[0] = 1;
  let root = 1;
  for (let n = 0; n < degree; n++) {
    for (let j = n + 1; j > 0; j--)
      polynomial[j] = polynomial[j - 1]! ^ multiply(polynomial[j]!, root);
    polynomial[0] = multiply(polynomial[0]!, root);
    root = multiply(root, 2);
  }
  const remainder = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    for (let j = 0; j < degree; j++)
      remainder[j] = remainder[j]! ^ multiply(factor, polynomial[degree - j - 1]!);
  }
  return remainder;
}

function put(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}
type Mode = 0 | 1 | 2 | 3;
export function kanjiValue(data: Uint8Array, offset: number): number {
  const lead = data[offset]!,
    trail = data[offset + 1] ?? 0;
  const pair = lead * 256 + trail;
  if (
    trail < 0x40 ||
    trail > 0xfc ||
    trail === 0x7f ||
    !((pair >= 0x8140 && pair <= 0x9ffc) || (pair >= 0xe040 && pair <= 0xebbf))
  )
    return -1;
  const reduced = pair - (pair <= 0x9ffc ? 0x8140 : 0xc140);
  return (reduced >>> 8) * 192 + (reduced & 255);
}
function countBits(mode: Mode, version: number, micro: boolean): number {
  if (micro)
    return [
      [3, 4, 5, 6],
      [0, 3, 4, 5],
      [0, 0, 4, 5],
      [0, 0, 3, 4]
    ][mode]![version - 1]!;
  return [
    [10, 12, 14],
    [9, 11, 13],
    [8, 16, 16],
    [8, 10, 12]
  ][mode]![version < 10 ? 0 : version < 27 ? 1 : 2]!;
}
function payloadBits(mode: Mode, count: number): number {
  return mode === 0
    ? Math.floor(count / 3) * 10 + [0, 4, 7][count % 3]!
    : mode === 1
      ? Math.floor(count / 2) * 11 + (count % 2) * 6
      : count * (mode === 2 ? 8 : 13);
}

// Shortest-path segmentation. QR's maximum input length bounds the search; the
// caller rejects longer payloads before allocating the cost and predecessor arrays.
function* segments(
  data: Uint8Array,
  version: number,
  options: EncodeOptions
): Generator<void, number[], void> {
  const micro = options.micro ?? false;
  const costs = new Float64Array(data.length + 1).fill(Infinity);
  const starts = new Uint16Array(data.length + 1);
  const modes = new Uint8Array(data.length + 1);
  costs[0] = 0;
  for (let start = 0; start < data.length; start++) {
    if (start % 16 === 0) yield;
    if (!Number.isFinite(costs[start])) continue;
    for (const mode of [0, 1, 2, 3] as const) {
      if ((options.byte && mode !== 2) || (mode === 3 && !options.kanji)) continue;
      const cb = countBits(mode, version, micro);
      if (!cb) continue;
      const step = mode === 3 ? 2 : 1;
      for (
        let end = start + step, count = 1;
        end <= data.length && count < 2 ** cb;
        end += step, count++
      ) {
        const byte = data[end - step]!;
        if (
          (mode === 0 && (byte < 48 || byte > 57)) ||
          (mode === 1 && alphabet.indexOf(String.fromCharCode(byte)) < 0) ||
          (mode === 3 && kanjiValue(data, end - 2) < 0)
        )
          break;
        const cost = costs[start]! + (micro ? version - 1 : 4) + cb + payloadBits(mode, count);
        if (cost < costs[end]!) {
          costs[end] = cost;
          starts[end] = start;
          modes[end] = mode;
        }
      }
    }
  }
  if (!Number.isFinite(costs[data.length]))
    throw new QrEncodingError("Input is not supported by this symbol version");
  const parts: { start: number; end: number; mode: Mode }[] = [];
  for (let end = data.length; end > 0; ) {
    const start = starts[end]!;
    parts.push({ start, end, mode: modes[end] as Mode });
    end = start;
  }
  const bits: number[] = [];
  if (options.append) {
    put(bits, 3, 4);
    put(bits, options.append[0], 4);
    put(bits, options.append[1] - 1, 4);
    put(bits, options.append[2], 8);
  }
  for (const { start, end, mode } of parts.reverse()) {
    put(bits, micro ? mode : [1, 2, 4, 8][mode]!, micro ? version - 1 : 4);
    put(bits, (end - start) / (mode === 3 ? 2 : 1), countBits(mode, version, micro));
    for (let i = start; i < end; ) {
      if (mode === 0) {
        const count = Math.min(3, end - i);
        let value = 0;
        for (let j = 0; j < count; j++) value = value * 10 + data[i++]! - 48;
        put(bits, value, [0, 4, 7, 10][count]!);
      } else if (mode === 1) {
        const a = alphabet.indexOf(String.fromCharCode(data[i++]!));
        if (i < end) put(bits, a * 45 + alphabet.indexOf(String.fromCharCode(data[i++]!)), 11);
        else put(bits, a, 6);
      } else if (mode === 2) put(bits, data[i++]!, 8);
      else {
        put(bits, kanjiValue(data, i), 13);
        i += 2;
      }
    }
  }
  return bits;
}

function capacity(
  version: number,
  level: number,
  micro: boolean
): { bits: number; ecc: number; blocks: number; total: number } {
  if (micro) {
    const ecc = microEcc[version]![level]!;
    return { bits: ecc ? (version * 2 + 8) ** 2 - 64 - ecc * 8 : 0, ecc, blocks: 1, total: 0 };
  }
  const [total, eccs] = capacities[version]!;
  return {
    bits: (total - eccs[level]!) * 8,
    ecc: eccs[level]!,
    blocks: blocks[version]![level]!,
    total
  };
}

function codewords(bits: number[], version: number, level: number, micro: boolean): number[] {
  const cap = capacity(version, level, micro);
  put(bits, 0, Math.min(cap.bits - bits.length, micro ? version * 2 + 1 : 4));
  while (bits.length < cap.bits && bits.length % 8) bits.push(0);
  let pad = 0;
  while (bits.length + 8 <= cap.bits) put(bits, pad++ % 2 ? 0x11 : 0xec, 8);
  while (bits.length < cap.bits) bits.push(0);
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, i) => {
    bytes[i >>> 3] = bytes[i >>> 3]! | (bit << (7 - (i % 8)));
  });
  if (micro) {
    for (const byte of reedSolomon(bytes, cap.ecc)) put(bits, byte, 8);
    return bits;
  }
  const dataBlocks: Uint8Array[] = [],
    eccBlocks: Uint8Array[] = [];
  const shortLength = Math.floor(bytes.length / cap.blocks),
    longCount = bytes.length % cap.blocks;
  let offset = 0;
  for (let i = 0; i < cap.blocks; i++) {
    const length = shortLength + (i >= cap.blocks - longCount ? 1 : 0);
    const block = bytes.subarray(offset, offset + length);
    offset += length;
    dataBlocks.push(block);
    eccBlocks.push(reedSolomon(block, cap.ecc / cap.blocks));
  }
  const result: number[] = [];
  for (const group of [dataBlocks, eccBlocks]) {
    const length = Math.max(...group.map((block) => block.length));
    for (let i = 0; i < length; i++)
      for (const block of group) if (i < block.length) put(result, block[i]!, 8);
  }
  return result;
}

function bch(value: number, polynomial: number, degree: number): number {
  let remainder = value << degree;
  for (let bit = 30; bit >= degree; bit--)
    if ((remainder >>> bit) & 1) remainder ^= polynomial << (bit - degree);
  return (value << degree) | remainder;
}
function maskBit(mask: number, x: number, y: number): boolean {
  return (
    [
      (x + y) % 2,
      y % 2,
      x % 3,
      (x + y) % 3,
      (Math.floor(y / 2) + Math.floor(x / 3)) % 2,
      ((x * y) % 2) + ((x * y) % 3),
      (((x * y) % 2) + ((x * y) % 3)) % 2,
      (((x + y) % 2) + ((x * y) % 3)) % 2
    ][mask] === 0
  );
}

function penalty(grid: boolean[][]): number {
  const n = grid.length;
  let score = 0,
    dark = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (grid[y]![x]) dark++;
      if (
        x &&
        y &&
        grid[y]![x] === grid[y - 1]![x] &&
        grid[y]![x] === grid[y]![x - 1] &&
        grid[y]![x] === grid[y - 1]![x - 1]
      )
        score += 3;
    }
  for (let axis = 0; axis < 2; axis++)
    for (let i = 0; i < n; i++) {
      const line = Array.from({ length: n }, (_, j) => (axis ? grid[j]![i]! : grid[i]![j]!));
      let run = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && line[j] === line[j - 1]) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      // Finder-like 1:1:3:1:1 patterns, with four white modules on either side.
      const runs: { color: boolean; length: number }[] = [{ color: false, length: n }];
      for (const color of line) {
        const last = runs[runs.length - 1]!;
        if (last.color === color) last.length++;
        else runs.push({ color, length: 1 });
      }
      if (!runs[runs.length - 1]!.color) runs[runs.length - 1]!.length += n;
      else runs.push({ color: false, length: n });
      for (let j = 1; j + 5 < runs.length; j++) {
        const unit = runs[j]!.length;
        if (
          runs[j]!.color &&
          runs[j + 1]!.length === unit &&
          runs[j + 2]!.length === unit * 3 &&
          runs[j + 3]!.length === unit &&
          runs[j + 4]!.length === unit &&
          (runs[j - 1]!.length >= unit * 4 || runs[j + 5]!.length >= unit * 4)
        )
          score += 40;
      }
    }
  score += Math.floor(Math.abs((100 * dark) / (n * n) - 50) / 5) * 10;
  return score;
}

function matrix(bits: number[], version: number, level: number, micro: boolean): boolean[][] {
  const n = micro ? 9 + version * 2 : 17 + version * 4;
  const base = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const fixed = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const set = (x: number, y: number, value: boolean): void => {
    if (x >= 0 && y >= 0 && x < n && y < n) {
      base[y]![x] = value;
      fixed[y]![x] = true;
    }
  };
  const finder = (cx: number, cy: number): void => {
    for (let y = -4; y <= 4; y++)
      for (let x = -4; x <= 4; x++) {
        const d = Math.max(Math.abs(x), Math.abs(y));
        set(cx + x, cy + y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  if (micro) {
    for (let i = 8; i < n; i++) {
      set(i, 0, i % 2 === 0);
      set(0, i, i % 2 === 0);
    }
    for (let i = 1; i <= 8; i++) {
      set(8, i, false);
      set(i, 8, false);
    }
  } else {
    finder(n - 4, 3);
    finder(3, n - 4);
    for (let i = 8; i < n - 8; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    if (version > 1) {
      const count = Math.floor(version / 7) + 2;
      const step = version === 32 ? 26 : Math.ceil((n - 13) / (count * 2 - 2)) * 2;
      const positions = [6];
      for (let i = count - 2; i >= 0; i--) positions.push(n - 7 - i * step);
      for (let yi = 0; yi < count; yi++)
        for (let xi = 0; xi < count; xi++) {
          if (
            (xi === 0 && yi === 0) ||
            (xi === 0 && yi === count - 1) ||
            (xi === count - 1 && yi === 0)
          )
            continue;
          for (let y = -2; y <= 2; y++)
            for (let x = -2; x <= 2; x++)
              set(positions[xi]! + x, positions[yi]! + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }
    }
    for (let i = 0; i < 9; i++)
      if (i !== 6) {
        set(8, i, false);
        set(i, 8, false);
      }
    for (let i = 0; i < 8; i++) {
      set(n - 1 - i, 8, false);
      set(8, n - 1 - i, false);
    }
    set(8, n - 8, true);
    if (version >= 7) {
      const value = bch(version, 0x1f25, 12);
      for (let i = 0; i < 18; i++) {
        set(n - 11 + (i % 3), Math.floor(i / 3), !!((value >> i) & 1));
        set(Math.floor(i / 3), n - 11 + (i % 3), !!((value >> i) & 1));
      }
    }
  }
  let bit = 0,
    upward = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (!micro && right === 6) right--;
    for (let row = 0; row < n; row++) {
      const y = upward ? n - 1 - row : row;
      for (let x = right; x >= right - 1; x--) if (!fixed[y]![x]) base[y]![x] = !!bits[bit++];
    }
    upward = !upward;
  }
  let best = base,
    bestScore = micro ? -Infinity : Infinity;
  for (let mask = 0; mask < (micro ? 4 : 8); mask++) {
    const grid = base.map((row, y) =>
      row.map((value, x) =>
        fixed[y]![x] ? value : value !== maskBit(micro ? [1, 4, 6, 7][mask]! : mask, x, y)
      )
    );
    if (micro) {
      const type =
        version === 1 ? 0 : version === 2 ? 1 + level : version === 3 ? 3 + level : 5 + level;
      const format = bch(type * 4 + mask, 0x537, 10) ^ 0x4445;
      for (let i = 0; i < 8; i++) grid[i + 1]![8] = !!((format >> i) & 1);
      for (let i = 0; i < 7; i++) grid[8]![7 - i] = !!((format >> (i + 8)) & 1);
    } else {
      const format = bch([1, 0, 3, 2][level]! * 8 + mask, 0x537, 10) ^ 0x5412;
      for (let i = 0; i < 15; i++) {
        const value = !!((format >> i) & 1);
        if (i < 6) grid[i]![8] = value;
        else if (i < 8) grid[i + 1]![8] = value;
        else grid[8]![i === 8 ? 7 : 14 - i] = value;
        if (i < 8) grid[8]![n - 1 - i] = value;
        else grid[n - 15 + i]![8] = value;
      }
    }
    let score: number;
    if (micro) {
      let a = 0,
        b = 0;
      for (let i = 1; i < n; i++) {
        a += Number(grid[n - 1]![i]);
        b += Number(grid[i]![n - 1]);
      }
      score = Math.min(a, b) * 16 + Math.max(a, b);
    } else score = penalty(grid);
    if (micro ? score > bestScore : score < bestScore) {
      best = grid;
      bestScore = score;
    }
  }
  return best;
}

export function* encodeQrSteps(
  data: Uint8Array,
  options: EncodeOptions = {}
): Generator<void, QrSymbol, void> {
  if (!data.length || data.length > 7089)
    throw new QrEncodingError("Input is empty or exceeds QR capacity");
  const micro = options.micro ?? false,
    level = "LMQH".indexOf(options.level ?? "L"),
    min = options.version === undefined || options.version === 0 ? 1 : options.version,
    max = micro ? 4 : 40;
  if (level < 0 || !Number.isInteger(min) || min < 1 || min > max || (micro && options.append))
    throw new QrEncodingError("Invalid QR version or level");
  let cached: number[] | undefined,
    cachedGroup = -1;
  for (let version = min; version <= max; version++) {
    const cap = capacity(version, level, micro);
    if (!cap.bits) continue;
    const group = micro ? version : version < 10 ? 0 : version < 27 ? 1 : 2;
    if (group !== cachedGroup) {
      try {
        cached = yield* segments(data, version, options);
      } catch (error) {
        if (!(error instanceof QrEncodingError)) throw error;
        cached = undefined;
      }
      cachedGroup = group;
    }
    if (cached && cached.length <= cap.bits)
      return {
        version,
        modules: matrix(codewords(cached.slice(), version, level, micro), version, level, micro)
      };
    if (options.strict) break;
  }
  throw new QrEncodingError("Input does not fit the requested QR symbol");
}

export function encodeQr(data: Uint8Array, options: EncodeOptions = {}): QrSymbol {
  const steps = encodeQrSteps(data, options);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

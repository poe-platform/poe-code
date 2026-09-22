import type { SyntaxReader } from "./syntax.js";
import { FilterBits, FilterOutput } from "./filter-buffer.js";
interface Tree {
  codes: Map<number, number>;
  maximum: number;
}
function tree(lengths: number[], r: SyntaxReader, allowEmpty = false): Tree {
  r.reserve(128);
  const counts = new Array<number>(16).fill(0);
  let maximum = 0;
  for (const n of lengths) {
    r.charge();
    counts[n] = counts[n]! + 1;
    maximum = Math.max(maximum, n);
  }
  if (!maximum && !allowEmpty) r.fail("SYNTAX", "empty Huffman tree");
  let left = 1;
  for (let i = 1; i <= 15; i++) {
    left = left * 2 - counts[i]!;
    if (left < 0) r.fail("SYNTAX", "oversubscribed Huffman tree");
  }
  if (left && maximum > 1) r.fail("SYNTAX", "incomplete Huffman tree");
  r.reserve(128);
  const next = new Array<number>(16).fill(0);
  let code = 0;
  for (let i = 1; i <= 15; i++) {
    code = (code + (i === 1 ? 0 : counts[i - 1]!)) * 2;
    next[i] = code;
  }
  const codes = new Map<number, number>();
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    r.charge();
    const n = lengths[symbol]!;
    if (!n) continue;
    r.reserve(64);
    codes.set(2 ** n + next[n]!, symbol);
    next[n] = next[n]! + 1;
  }
  return { codes, maximum };
}
function symbol(bits: FilterBits, t: Tree, r: SyntaxReader): number {
  let code = 0;
  for (let n = 1; n <= t.maximum; n++) {
    code = code * 2 + bits.read(1);
    const value = t.codes.get(2 ** n + code);
    if (value !== undefined) return value;
  }
  return r.fail("SYNTAX", "invalid Huffman code");
}
// RFC 1951 code-length permutation and length/distance tables.
const permutation = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const lengthBase = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258
];
const lengthExtra = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
];
const distanceBase = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577
];
const distanceExtra = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
];
export function flate(data: Uint8Array, r: SyntaxReader): Uint8Array {
  if (
    data.length < 6 ||
    (data[0]! & 15) !== 8 ||
    data[0]! >> 4 > 7 ||
    (data[0]! * 256 + data[1]!) % 31 ||
    data[1]! & 32
  )
    r.fail("SYNTAX", "invalid or dictionary-dependent zlib header");
  const bits = new FilterBits(data.subarray(2, data.length - 4), r, true);
  const out = new FilterOutput(r);
  let final = 0;
  do {
    final = bits.read(1);
    const type = bits.read(2);
    if (type === 0) {
      bits.align();
      const count = bits.read(16),
        inverse = bits.read(16);
      if (count + inverse !== 65535) r.fail("SYNTAX", "invalid stored block length");
      for (let i = 0; i < count; i++) out.push(bits.read(8));
      continue;
    }
    if (type === 3) r.fail("SYNTAX", "reserved deflate block");
    let literal: Tree, distance: Tree;
    r.reserve((type === 1 ? 320 : 640) * 8);
    if (type === 1) {
      literal = tree(
        Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)),
        r
      );
      distance = tree(new Array<number>(32).fill(5), r);
    } else {
      const nl = bits.read(5) + 257,
        nd = bits.read(5) + 1,
        nc = bits.read(4) + 4;
      if (nl > 286) r.fail("SYNTAX", "invalid dynamic tree counts");
      r.reserve(19 * 8);
      const cl = new Array<number>(19).fill(0);
      for (let i = 0; i < nc; i++) cl[permutation[i]!] = bits.read(3);
      const ct = tree(cl, r),
        lengths: number[] = [];
      while (lengths.length < nl + nd) {
        const s = symbol(bits, ct, r);
        if (s < 16) lengths.push(s);
        else {
          if (s === 16 && !lengths.length) r.fail("SYNTAX", "missing previous code length");
          const count = bits.read(s === 16 ? 2 : s === 17 ? 3 : 7) + (s === 18 ? 11 : 3);
          if (count > nl + nd - lengths.length) r.fail("SYNTAX", "code length repeat overflow");
          const value = s === 16 ? lengths.at(-1)! : 0;
          for (let i = 0; i < count; i++) {
            r.charge();
            lengths.push(value);
          }
        }
      }
      if (!lengths[256]) r.fail("SYNTAX", "missing end-of-block code");
      // HDIST admits 32 entries, but reserved distance symbols may never be used.
      literal = tree(lengths.slice(0, nl), r);
      distance = tree(lengths.slice(nl), r, true);
    }
    while (true) {
      const s = symbol(bits, literal, r);
      if (s < 256) {
        out.push(s);
        continue;
      }
      if (s === 256) break;
      if (s > 285) r.fail("SYNTAX", "reserved length code");
      const length = lengthBase[s - 257]! + bits.read(lengthExtra[s - 257]!);
      const d = symbol(bits, distance, r);
      if (d > 29) r.fail("SYNTAX", "reserved distance code");
      const offset = distanceBase[d]! + bits.read(distanceExtra[d]!);
      if (offset > out.values.length || offset > 2 ** ((data[0]! >> 4) + 8))
        r.fail("SYNTAX", "invalid deflate distance");
      for (let i = 0; i < length; i++) out.push(out.values[out.values.length - offset]!);
    }
  } while (!final);
  // The zlib trailer follows BFINAL, not the enclosing PDF stream's boundary.
  // Preserve any remaining raw bytes just as the other terminated codecs do.
  const end = 2 + bits.consumed;
  if (end > data.length - 4) r.fail("SYNTAX", "truncated zlib checksum");
  let a = 1,
    b = 0;
  for (const byte of out.values) {
    r.charge();
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const checksum =
    data[end]! * 16777216 + data[end + 1]! * 65536 + data[end + 2]! * 256 + data[end + 3]!;
  if (b * 65536 + a !== checksum) r.fail("SYNTAX", "zlib checksum mismatch");
  return out.finish();
}

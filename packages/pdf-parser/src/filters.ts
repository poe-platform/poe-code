import { SyntaxReader, resolvePdfReference } from "./syntax.js";
import type { PdfObject, PdfParseOptions } from "./syntax.js";
import { FilterBits, FilterOutput } from "./filter-buffer.js";
import { flate } from "./flate.js";
export interface PdfFilterOptions extends Pick<PdfParseOptions, "limits" | "signal"> {
  lookup?: (reference: PdfObject) => PdfObject;
  imageMode?: "reject" | "preserve";
}
export interface PdfDecodedStream {
  raw: Uint8Array;
  bytes: Uint8Array;
  /** Nonempty means bytes remain encoded. Never treat these as decoded content. */
  remainingFilters: string[];
}
const aliases: Readonly<Record<string, string>> = Object.freeze({
  AHx: "ASCIIHexDecode",
  A85: "ASCII85Decode",
  LZW: "LZWDecode",
  Fl: "FlateDecode",
  RL: "RunLengthDecode",
  CCF: "CCITTFaxDecode",
  DCT: "DCTDecode"
});
const images = new Set(["DCTDecode", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode"]);
const white = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
function ascii(data: Uint8Array, name: string, r: SyntaxReader): Uint8Array {
  const out = new FilterOutput(r);
  let group = 0,
    count = 0,
    ended = false;
  for (let i = 0; i < data.length; i++) {
    r.charge();
    const c = data[i]!;
    if (white(c)) continue;
    if (name === "ASCIIHexDecode") {
      if (c === 62) {
        if (count) out.push(group * 16);
        ended = true;
        break;
      }
      const v =
        c >= 48 && c <= 57
          ? c - 48
          : c >= 65 && c <= 70
            ? c - 55
            : c >= 97 && c <= 102
              ? c - 87
              : -1;
      if (v < 0) r.fail("SYNTAX", "invalid ASCIIHex digit");
      group = group * 16 + v;
      count++;
      if (count === 2) {
        out.push(group);
        group = 0;
        count = 0;
      }
    } else {
      if (c === 126) {
        if (data[++i] !== 62 || count === 1) r.fail("SYNTAX", "invalid ASCII85 terminator");
        if (count) {
          const original = count;
          while (count < 5) {
            group = group * 85 + 84;
            count++;
          }
          if (group > 4294967295) r.fail("SYNTAX", "ASCII85 tuple overflow");
          for (let j = 0; j < original - 1; j++) out.push(Math.floor(group / 256 ** (3 - j)) % 256);
        }
        ended = true;
        break;
      }
      if (c === 122) {
        if (count) r.fail("SYNTAX", "ASCII85 z inside tuple");
        for (let j = 0; j < 4; j++) out.push(0);
        continue;
      }
      if (c < 33 || c > 117) r.fail("SYNTAX", "invalid ASCII85 digit");
      group = group * 85 + c - 33;
      count++;
      if (count === 5) {
        if (group > 4294967295) r.fail("SYNTAX", "ASCII85 tuple overflow");
        for (let j = 0; j < 4; j++) out.push(Math.floor(group / 256 ** (3 - j)) % 256);
        group = 0;
        count = 0;
      }
    }
  }
  if (!ended) r.fail("SYNTAX", "missing ASCII filter terminator");
  return out.finish();
}
function runLength(data: Uint8Array, r: SyntaxReader): Uint8Array {
  const out = new FilterOutput(r);
  for (let i = 0; i < data.length; ) {
    r.charge();
    const n = data[i++]!;
    if (n === 128) return out.finish();
    if (n < 128) {
      if (n + 1 > data.length - i) r.fail("SYNTAX", "truncated RunLength literal");
      for (let j = 0; j <= n; j++) out.push(data[i++]!);
    } else {
      if (i === data.length) r.fail("SYNTAX", "truncated RunLength repeat");
      const value = data[i++]!;
      for (let j = 0; j < 257 - n; j++) out.push(value);
    }
  }
  return r.fail("SYNTAX", "missing RunLength end code");
}
function lzw(data: Uint8Array, early: number, r: SyntaxReader): Uint8Array {
  r.reserve(4096 * 4);
  const prefix = new Uint16Array(4096),
    suffix = new Uint8Array(4096),
    stack = new Uint8Array(4096);
  const bits = new FilterBits(data, r, false),
    out = new FilterOutput(r);
  let next = 258,
    width = 9,
    previous = -1,
    first = 0;
  while (true) {
    const code = bits.read(width);
    if (code === 257) return out.finish();
    if (code === 256) {
      next = 258;
      width = 9;
      previous = -1;
      continue;
    }
    if (code > next || (code === next && previous < 0)) r.fail("SYNTAX", "invalid LZW code");
    let current = code === next ? previous : code,
      length = 0;
    if (code === next) stack[length++] = first;
    while (current >= 258) {
      r.charge();
      if (current >= next || length >= 4095) r.fail("SYNTAX", "invalid LZW dictionary chain");
      stack[length++] = suffix[current]!;
      current = prefix[current]!;
    }
    if (current > 255) r.fail("SYNTAX", "invalid LZW dictionary root");
    first = current;
    stack[length++] = first;
    while (length) out.push(stack[--length]!);
    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next] = first;
      next++;
      if (width < 12 && next + early === 2 ** width) width++;
    }
    previous = code;
  }
}
function predictor(
  data: Uint8Array,
  p: number,
  colors: number,
  columns: number,
  bpc: number,
  r: SyntaxReader
): Uint8Array {
  if (p === 1) return data;
  if (p !== 2 && (p < 10 || p > 15)) r.fail("SYNTAX", "unsupported predictor value");
  const samples = columns * colors,
    bits = samples * bpc;
  if (!Number.isSafeInteger(bits) || Math.ceil(bits / 8) > r.limits.expandedBytes)
    r.fail("LIMIT", "predictor row limit");
  const row = Math.ceil(bits / 8),
    stride = row + (p === 2 ? 0 : 1),
    pixel = Math.ceil((colors * bpc) / 8);
  if (data.length % stride) r.fail("SYNTAX", "truncated predictor row");
  r.reserve(row * 2);
  let prior = new Uint8Array(row),
    current = new Uint8Array(row);
  const out = new FilterOutput(r);
  for (let start = 0; start < data.length; start += stride) {
    r.charge(row);
    if (p === 2) {
      current.set(data.subarray(start, start + row));
      const sample = (index: number) => {
        let v = 0;
        for (let j = 0; j < bpc; j++) {
          r.charge();
          const bit = index * bpc + j;
          v = v * 2 + ((current[Math.floor(bit / 8)]! >> (7 - (bit % 8))) & 1);
        }
        return v;
      };
      for (let i = colors; i < samples; i++) {
        const value = (sample(i) + sample(i - colors)) % 2 ** bpc;
        for (let j = 0; j < bpc; j++) {
          r.charge();
          const bit = i * bpc + j,
            offset = Math.floor(bit / 8),
            mask = 1 << (7 - (bit % 8));
          current[offset] = (current[offset]! & ~mask) | ((value >> (bpc - 1 - j)) & 1 ? mask : 0);
        }
      }
    } else {
      const kind = data[start]!;
      if (kind > 4) r.fail("SYNTAX", "invalid PNG predictor tag");
      for (let i = 0; i < row; i++) {
        r.charge();
        const a = i >= pixel ? current[i - pixel]! : 0,
          b = prior[i]!,
          c = i >= pixel ? prior[i - pixel]! : 0;
        let prediction = 0;
        if (kind === 1) prediction = a;
        if (kind === 2) prediction = b;
        if (kind === 3) prediction = Math.floor((a + b) / 2);
        if (kind === 4) {
          const base = a + b - c,
            da = Math.abs(base - a),
            db = Math.abs(base - b),
            dc = Math.abs(base - c);
          prediction = da <= db && da <= dc ? a : db <= dc ? b : c;
        }
        current[i] = (data[start + 1 + i]! + prediction) & 255;
      }
    }
    for (const v of current) out.push(v);
    [prior, current] = [current, prior];
  }
  return out.finish();
}
/** Internal entry shares document budgets; standalone entry snapshots caller bytes. */
export function decodeStreamFilters(
  raw: Uint8Array,
  dictionary: PdfObject,
  r: SyntaxReader,
  options: PdfFilterOptions
): PdfDecodedStream {
  r.check();
  if (dictionary.kind !== "dictionary") r.fail("ARGUMENT", "stream dictionary required");
  if (
    options.imageMode !== undefined &&
    options.imageMode !== "preserve" &&
    options.imageMode !== "reject"
  )
    r.fail("ARGUMENT", "invalid image mode");
  const resolve = (o: PdfObject | undefined): PdfObject | undefined => {
    if (o?.kind !== "reference") return o;
    // Reserve the first visited key before resolution, then the next key before
    // lookup can return another reference. The final unused slot is conservative.
    r.reserve(128);
    return resolvePdfReference(
      o,
      (ref) => {
        r.charge();
        r.reserve(128);
        if (!options.lookup) return r.fail("REFERENCE", "filter reference needs lookup");
        return options.lookup(ref);
      },
      { maxReferences: r.limits.objects, ...(r.options.signal ? { signal: r.options.signal } : {}) }
    );
  };
  const name = (o: PdfObject): string => {
    if (o.kind !== "name" || !o.bytes) return r.fail("SYNTAX", "filter name required");
    let s = "";
    for (const c of o.bytes) {
      r.charge();
      r.reserve(2);
      s += String.fromCharCode(c);
    }
    return s;
  };
  const field = (o: PdfObject, key: string): PdfObject | undefined => {
    let value: PdfObject | undefined;
    for (const e of o.entries ?? []) {
      r.charge();
      if (name(e.key) === key) {
        if (value) r.fail("SYNTAX", "duplicate filter parameter");
        value = e.value;
      }
    }
    return value;
  };
  const filter = resolve(field(dictionary, "Filter") ?? field(dictionary, "F"));
  const params = resolve(field(dictionary, "DecodeParms") ?? field(dictionary, "DP"));
  let filters: PdfObject[] = [];
  if (filter && filter.kind !== "null")
    filters = filter.kind === "array" ? (filter.items ?? []) : [filter];
  if (filters.length > r.limits.objects) r.fail("LIMIT", "filter count limit");
  r.reserve(filters.length * 32);
  const names = filters.map((o) => {
    r.charge();
    const n = name(resolve(o)!);
    return Object.hasOwn(aliases, n) ? aliases[n]! : n;
  });
  let parameters: (PdfObject | undefined)[];
  if (params?.kind === "array") {
    if (params.items?.length !== names.length)
      r.fail("SYNTAX", "DecodeParms array length mismatch");
    parameters = params.items!;
  } else {
    if (params && params.kind !== "null" && (params.kind !== "dictionary" || names.length !== 1))
      r.fail("SYNTAX", "invalid DecodeParms");
    parameters = names.map(() => params);
  }
  let data = raw;
  for (let i = 0; i < names.length; i++) {
    r.charge();
    const n = names[i]!,
      dp = resolve(parameters[i]);
    if (dp && dp.kind !== "null" && dp.kind !== "dictionary")
      r.fail("SYNTAX", "invalid filter parameters");
    const integer = (key: string, fallback: number): number => {
      const v = dp?.kind === "dictionary" ? resolve(field(dp, key)) : undefined;
      if (!v || v.kind === "null") return fallback;
      if (v.kind !== "number" || !Number.isSafeInteger(v.value) || v.raw?.includes(46))
        return r.fail("SYNTAX", "invalid filter integer");
      return v.value as number;
    };
    if (images.has(n) && options.imageMode === "preserve")
      return { raw, bytes: data, remainingFilters: names.slice(i) };
    if (n === "ASCIIHexDecode" || n === "ASCII85Decode") data = ascii(data, n, r);
    else if (n === "RunLengthDecode") data = runLength(data, r);
    else if (n === "Crypt") {
      const cryptName = dp?.kind === "dictionary" ? resolve(field(dp, "Name")) : undefined;
      if (cryptName && name(cryptName) !== "Identity")
        r.fail("UNSUPPORTED", "non-Identity crypt filter requires encryption decoding");
    } else if (n === "FlateDecode" || n === "LZWDecode") {
      const p = integer("Predictor", 1),
        colors = integer("Colors", 1),
        columns = integer("Columns", 1),
        bpc = integer("BitsPerComponent", 8),
        early = integer("EarlyChange", 1);
      if (
        colors < 1 ||
        columns < 1 ||
        ![1, 2, 4, 8, 16].includes(bpc) ||
        (early !== 0 && early !== 1)
      )
        r.fail("SYNTAX", "invalid predictor or EarlyChange");
      data = n === "FlateDecode" ? flate(data, r) : lzw(data, early, r);
      data = predictor(data, p, colors, columns, bpc, r);
    } else r.fail("UNSUPPORTED", `unsupported filter ${n}`);
  }
  return { raw, bytes: data, remainingFilters: [] };
}
export function decodePdfStream(
  input: Uint8Array | readonly Uint8Array[],
  dictionary: PdfObject,
  options: PdfFilterOptions = {}
): PdfDecodedStream {
  const r = new SyntaxReader(input, options);
  return decodeStreamFilters(r.data, dictionary, r, options);
}

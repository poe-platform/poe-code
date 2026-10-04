import { compareByteArrays } from "safe-bash-io-engine/byte-encoding";
import { SortRecord, type SortStorage } from "./records.js";
import type { SortKey } from "./sort.js";
import type { SortWork } from "./work.js";

/** Each cursor caches at most one page, including while scanning a huge key. */
class View {
  private page: Uint8Array = new Uint8Array(0);
  private pageStart = 0;
  constructor(readonly record: SortRecord, readonly work: SortWork, readonly start = 0, readonly length = record.length) {}
  async at(index: number): Promise<number | undefined> {
    if (index < 0 || index >= this.length) return undefined;
    if (index < this.pageStart || index >= this.pageStart + this.page.length) {
      this.page = await this.record.read(this.start + index, Math.min(16 * 1024, this.length - index));
      this.pageStart = index;
      await this.work.charge(this.page.length);
    }
    return this.page[index - this.pageStart];
  }
  slice(start: number, end = this.length): View {
    const first = Math.min(this.length, Math.max(0, start));
    return new View(this.record, this.work, this.start + first, Math.max(0, Math.min(this.length, end) - first));
  }
  async *chunks(): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < this.length; offset += 16 * 1024) {
      const bytes = await this.record.read(this.start + offset, Math.min(16 * 1024, this.length - offset));
      await this.work.charge(bytes.length);
      yield bytes;
    }
  }
  async materialize(): Promise<Uint8Array> {
    const bytes = new Uint8Array(this.length);
    let offset = 0;
    for await (const part of this.chunks()) { bytes.set(part, offset); offset += part.length; }
    return bytes;
  }
}

const blank = (byte: number | undefined): boolean => byte === 32 || byte === 9;
const digit = (byte: number | undefined): boolean => byte !== undefined && byte >= 48 && byte <= 57;
const alpha = (byte: number | undefined): boolean => byte !== undefined && (byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122);

async function keyView(line: View, key: SortKey, separator: number | undefined, blanks: boolean): Promise<View> {
  let first: { start: number; end: number } | undefined, last: typeof first;
  let number = 0, offset = 0;
  const visit = (start: number, end: number): void => {
    number++;
    if (number === key.start) first = { start, end };
    if (number === key.end) last = { start, end };
  };
  if (separator !== undefined) {
    let start = 0;
    while (offset <= line.length) {
      if (offset === line.length || await line.at(offset) === separator) { visit(start, offset); start = offset + 1; }
      offset++;
    }
  } else {
    while (offset < line.length) {
      const start = offset;
      while (offset < line.length && blank(await line.at(offset))) offset++;
      while (offset < line.length && !blank(await line.at(offset))) offset++;
      visit(start, offset);
    }
  }
  const fieldStart = async (field: typeof first, skip: boolean): Promise<number> => {
    let start = field?.start ?? line.length;
    if (skip) while (start < (field?.end ?? line.length) && blank(await line.at(start))) start++;
    return start;
  };
  const inherited = !key.flags.size && blanks;
  const start = await fieldStart(first, key.startBlanks || inherited) + key.startCharacter - 1;
  const end = key.end === undefined || last === undefined ? line.length : key.endCharacter === undefined ? last.end
    : Math.min(line.length, await fieldStart(last, key.endBlanks || inherited) + key.endCharacter);
  return line.slice(start, Math.max(start, end));
}

async function transformed(view: View, flags: ReadonlySet<string>, resources: SortStorage): Promise<{ view: View; close(): Promise<void> }> {
  if (!flags.has("f") && !flags.has("d") && !flags.has("i")) return { view, close: async () => {} };
  const storage = resources.acquire();
  const offset = storage.allocate(0);
  let length = 0;
  try {
    for await (const chunk of view.chunks()) {
      const output = new Uint8Array(chunk.length);
      let used = 0;
      for (let byte of chunk) {
        if (flags.has("f") && byte >= 97 && byte <= 122) byte -= 32;
        const keep = flags.has("d") ? blank(byte) || digit(byte) || alpha(byte) : !flags.has("i") || byte >= 32 && byte <= 126;
        if (keep) output[used++] = byte;
      }
      await storage.append(output.subarray(0, used)); length += used;
    }
    return { view: new View(new SortRecord(length, undefined, storage, offset), view.work), close: () => resources.release(storage) };
  } catch (error) { await resources.release(storage); throw error; }
}

async function bytesCompare(left: View, right: View): Promise<number> {
  const length = Math.min(left.length, right.length);
  for (let offset = 0; offset < length; offset += 16 * 1024) {
    const count = Math.min(16 * 1024, length - offset);
    const first = await left.record.read(left.start + offset, count), second = await right.record.read(right.start + offset, count);
    await left.work.charge(2 * count);
    const order = compareByteArrays(first, second);
    if (order) return order;
  }
  return left.length - right.length;
}

interface Numeric {
  negative: boolean; rank: number; whole: number; wholeLength: number; fraction: number; fractionLength: number;
}
async function numeric(view: View, human: boolean): Promise<Numeric> {
  let offset = 0;
  while (blank(await view.at(offset))) offset++;
  const negative = await view.at(offset) === 45;
  if (negative) offset++;
  while (await view.at(offset) === 48) offset++;
  const whole = offset;
  while (digit(await view.at(offset))) offset++;
  const wholeLength = offset - whole;
  let fraction = offset, fractionEnd = offset;
  if (await view.at(offset) === 46) {
    fraction = ++offset; fractionEnd = offset;
    while (digit(await view.at(offset))) {
      if (await view.at(offset) !== 48) fractionEnd = offset + 1;
      offset++;
    }
  }
  const fractionLength = fractionEnd - fraction;
  const nonzero = wholeLength > 0 || fractionLength > 0;
  const suffix = await view.at(offset);
  const rank = human && nonzero ? "KMGTPEZYRQ".indexOf(String.fromCharCode(suffix === 107 ? 75 : suffix ?? 0)) + 1 : 0;
  return { negative: negative && nonzero, rank, whole, wholeLength, fraction, fractionLength };
}

async function numericCompare(left: View, right: View, human: boolean): Promise<number> {
  const a = await numeric(left, human), b = await numeric(right, human);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  let order = a.rank - b.rank || Math.max(1, a.wholeLength) - Math.max(1, b.wholeLength);
  if (!order) for (let i = 0; i < Math.max(a.wholeLength, b.wholeLength); i++) {
    order = (i < a.wholeLength ? (await left.at(a.whole + i))! : 48) - (i < b.wholeLength ? (await right.at(b.whole + i))! : 48);
    if (order) break;
  }
  if (!order) for (let i = 0; i < Math.max(a.fractionLength, b.fractionLength); i++) {
    order = (i < a.fractionLength ? (await left.at(a.fraction + i))! : 48) - (i < b.fractionLength ? (await right.at(b.fraction + i))! : 48);
    if (order) break;
  }
  return a.negative ? -order : order;
}

async function exponent(view: View, start: number, trim = false): Promise<bigint | undefined> {
  if (trim) while (true) {
    const byte = await view.at(start);
    if (byte === 32 || byte === 160 || byte !== undefined && byte >= 9 && byte <= 13) start++;
    else break;
  }
  const first = await view.at(start);
  const negative = first === 45;
  let offset = start + (first === 45 || first === 43 ? 1 : 0);
  if (!digit(await view.at(offset))) return undefined;
  const ceiling = BigInt(Number.MAX_SAFE_INTEGER) * 2n;
  let value = 0n;
  while (digit(await view.at(offset))) {
    if (value < ceiling) value = value * 10n + BigInt((await view.at(offset))! - 48);
    if (value > ceiling) value = ceiling;
    offset++;
  }
  return negative ? -value : value;
}

async function generalNumeric(view: View): Promise<{ rank: number; value: number }> {
  let offset = 0;
  while (true) { const byte = await view.at(offset); if (byte === 32 || byte !== undefined && byte >= 9 && byte <= 13) offset++; else break; }
  const decimalStart = offset;
  const first = await view.at(offset);
  let negative = first === 45;
  if (first === 45 || first === 43) offset++;
  let token = "";
  for (let i = 0; i < 3; i++) token += String.fromCharCode(await view.at(offset + i) ?? 0).toLowerCase();
  if (token === "nan") return { rank: 1, value: 0 };
  if (token === "inf") return { rank: 2, value: negative ? -Infinity : Infinity };
  if (token.startsWith("0x")) {
    let index = offset + 2, value = 0, scale = 1, fractional = false, digits = 0;
    while (index < view.length) {
      const byte = await view.at(index);
      if (byte === 46 && !fractional) { fractional = true; index++; continue; }
      const digit = "0123456789abcdef".indexOf(String.fromCharCode(byte!).toLowerCase());
      if (digit < 0) break;
      digits++;
      if (fractional) { scale /= 16; value += digit * scale; } else value = value * 16 + digit;
      index++;
    }
    if (digits) {
      const byte = await view.at(index);
      if (byte === 112 || byte === 80) { const power = await exponent(view, index + 1, true); if (power !== undefined && value !== 0) value *= 2 ** Number(power); }
      return { rank: 2, value: negative ? -value : value };
    }
  }
  // The legacy hexadecimal/NaN/inf grammar trims ASCII whitespace first;
  // Number.parseFloat's decimal fallback additionally trims Latin-1 NBSP.
  offset = decimalStart;
  while (true) {
    const byte = await view.at(offset);
    if (byte === 32 || byte === 160 || byte !== undefined && byte >= 9 && byte <= 13) offset++;
    else break;
  }
  const sign = await view.at(offset); negative = sign === 45;
  if (sign === 43 || sign === 45) offset++;
  let infinity = "";
  for (let i = 0; i < 8; i++) infinity += String.fromCharCode(await view.at(offset + i) ?? 0);
  if (infinity === "Infinity") return { rank: 2, value: negative ? -Infinity : Infinity };
  let count = 0, whole = 0, firstNonzero = -1, mantissa = "", sticky = false, dot = false;
  while (offset < view.length) {
    const byte = await view.at(offset);
    if (byte === 46 && !dot) { dot = true; offset++; continue; }
    if (!digit(byte)) break;
    if (!dot) whole++;
    if (firstNonzero < 0 && byte !== 48) firstNonzero = count;
    if (firstNonzero >= 0) {
      if (mantissa.length < 800) mantissa += String.fromCharCode(byte!);
      else if (byte !== 48) sticky = true;
    }
    count++; offset++;
  }
  if (!count) return { rank: 0, value: 0 };
  if (firstNonzero < 0) return { rank: 2, value: negative ? -0 : 0 };
  let power = BigInt(whole - firstNonzero - 1);
  const marker = await view.at(offset);
  if (marker === 69 || marker === 101) power += await exponent(view, offset + 1) ?? 0n;
  // Every binary64 midpoint has fewer than 800 significant decimal digits.
  // A nonzero discarded suffix distinguishes an exact midpoint from above it.
  if (sticky) mantissa += "1";
  const value = Number(`${negative ? "-" : ""}${mantissa[0]}.${mantissa.slice(1)}e${power}`);
  return { rank: 2, value };
}

async function month(view: View): Promise<number> {
  let offset = 0; while (blank(await view.at(offset))) offset++;
  let name = "";
  for (let i = 0; i < 3; i++) { const byte = await view.at(offset + i); if (byte === undefined) break; name += String.fromCharCode(byte); }
  return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(name.toUpperCase()) + 1;
}

function versionOrder(byte: number | undefined): number {
  return byte === 126 ? -1 : byte === undefined || digit(byte) ? 0 : alpha(byte) ? byte : byte + 256;
}
async function versionParts(left: View, right: View): Promise<number> {
  let a = 0, b = 0;
  while (a < left.length || b < right.length) {
    while (a < left.length && !digit(await left.at(a)) || b < right.length && !digit(await right.at(b))) {
      const order = versionOrder(await left.at(a)) - versionOrder(await right.at(b));
      if (order) return order;
      if (a < left.length) a++; if (b < right.length) b++;
    }
    while (await left.at(a) === 48) a++;
    while (await right.at(b) === 48) b++;
    let difference = 0;
    while (digit(await left.at(a)) && digit(await right.at(b))) {
      difference ||= (await left.at(a))! - (await right.at(b))!;
      a++; b++;
    }
    if (digit(await left.at(a))) return 1;
    if (digit(await right.at(b))) return -1;
    if (difference) return difference;
  }
  return 0;
}
async function versionPrefix(view: View): Promise<View> {
  let match = view.length, readAlpha = false;
  for (let index = await view.at(0) === 46 ? 1 : 0; index < view.length; index++) {
    const byte = await view.at(index), letter = byte === 126 || alpha(byte);
    if (readAlpha) { readAlpha = false; if (!letter) match = view.length; }
    else if (byte === 46) { readAlpha = true; if (match === view.length) match = index; }
    else if (!(letter || digit(byte))) match = view.length;
  }
  return view.slice(0, readAlpha ? view.length : match);
}
async function versions(left: View, right: View): Promise<number> {
  const special = async (v: View) => !v.length ? 0 : await v.at(0) !== 46 ? 4 : v.length === 1 ? 1 : v.length === 2 && await v.at(1) === 46 ? 2 : 3;
  return await special(left) - await special(right)
    || await versionParts(await versionPrefix(left), await versionPrefix(right)) || await versionParts(left, right);
}

export async function compareLargeKeys(
  left: SortRecord, right: SortRecord, keys: readonly SortKey[], globalFlags: ReadonlySet<string>, separator: number | undefined,
  work: SortWork, resources: SortStorage, locale?: (left: Uint8Array, right: Uint8Array) => number | Promise<number>,
): Promise<number> {
  for (const key of keys.length ? keys : [undefined]) {
    const flags = key?.flags.size ? key.flags : globalFlags;
    let a = new View(left, work), b = new View(right, work);
    if (key) { a = await keyView(a, key, separator, flags.has("b")); b = await keyView(b, key, separator, flags.has("b")); }
    else if (flags.has("b")) {
      let first = 0, second = 0;
      while (blank(await a.at(first))) first++;
      while (blank(await b.at(second))) second++;
      a = a.slice(first); b = b.slice(second);
    }
    const first = await transformed(a, flags, resources);
    let second: Awaited<ReturnType<typeof transformed>> | undefined;
    try {
      second = await transformed(b, flags, resources);
      a = first.view; b = second.view;
      let order: number;
      if (flags.has("g")) { const x = await generalNumeric(a), y = await generalNumeric(b); order = x.rank - y.rank || (x.value < y.value ? -1 : x.value > y.value ? 1 : 0); }
      else if (flags.has("M")) order = await month(a) - await month(b);
      else if (flags.has("V")) order = await versions(a, b);
      else if (flags.has("n") || flags.has("h")) order = await numericCompare(a, b, flags.has("h"));
      else order = locale ? await locale(await a.materialize(), await b.materialize()) : await bytesCompare(a, b);
      if (order) return flags.has("r") ? -order : order;
    } finally { try { await second?.close(); } finally { await first.close(); } }
  }
  return 0;
}

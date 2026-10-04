import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import { XmlBudget } from "./limits.js";

const whitespace = (point: number): boolean => point === 32 || point === 9 || point === 10 || point === 13;
const utf8Size = (point: number): number => point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
type Range = { storage: PagedStorage; start: number };

/** Small strings stay inline; larger values use fixed-width code points in the
 * caller's shared page store. Seeking and slicing never require a full string. */
export class TextValue {
  private constructor(private readonly data: string | Range, readonly size: number, readonly byteLength: number, private readonly budget: XmlBudget) {}
  get storage(): PagedStorage | undefined { return typeof this.data === "string" ? undefined : this.data.storage; }

  static async create(source: Iterable<string> | AsyncIterable<string>, budget: XmlBudget, storage?: PagedStorage): Promise<TextValue> {
    let small = "", size = 0, byteLength = 0, start: number | undefined, used = 0;
    const bytes = new Uint8Array(16384), view = new DataView(bytes.buffer);
    let high: number | undefined;
    function* points(part: string | undefined): Generator<number> {
      for (const character of part ?? "") {
        const point = character.codePointAt(0)!;
        if (high !== undefined) {
          const pending = high; high = undefined;
          if (point >= 0xdc00 && point <= 0xdfff) { yield 0x10000 + (pending - 0xd800) * 1024 + point - 0xdc00; continue; }
          yield pending;
        }
        if (point >= 0xd800 && point <= 0xdbff) high = point;
        else yield point;
      }
      if (part === undefined && high !== undefined) { yield high; high = undefined; }
    }
    const parts = (async function* () { yield* source; yield undefined; })();
    for await (const part of parts) for (const point of points(part)) {
      const checkpoint = budget.tick(); if (checkpoint) await checkpoint;
      if (storage && used === 4096) {
        start ??= storage.allocate(0);
        await storage.append(bytes); used = 0; small = "";
      }
      if (storage) { view.setUint32(used * 4, point, true); used++; }
      if (start === undefined) small += String.fromCodePoint(point);
      size++; byteLength += utf8Size(point);
    }
    if (start === undefined) return new TextValue(small, size, byteLength, budget);
    if (used) await storage!.append(bytes.subarray(0, used * 4));
    return new TextValue({ storage: storage!, start }, size, byteLength, budget);
  }

  async *chunks(): AsyncGenerator<string> {
    if (typeof this.data === "string") { yield this.data; return; }
    for (let at = 0; at < this.size; at += 4096) {
      const count = Math.min(4096, this.size - at);
      const checkpoint = this.budget.tick(count); if (checkpoint) await checkpoint;
      const bytes = await this.data.storage.read(this.data.start + at * 4, count * 4);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let text = "";
      for (let index = 0; index < count; index++) text += String.fromCodePoint(view.getUint32(index * 4, true));
      yield text;
    }
  }

  /** Explicit buffering convenience for the legacy tree API. */
  async string(): Promise<string> {
    let result = "";
    for await (const part of this.chunks()) result += part;
    return result;
  }

  async point(index: number): Promise<number | undefined> {
    if (index < 0 || index >= this.size) return undefined;
    const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint;
    if (typeof this.data === "string") {
      let at = 0;
      for (const character of this.data) if (at++ === index) return character.codePointAt(0)!;
      return undefined;
    }
    const bytes = await this.data.storage.read(this.data.start + index * 4, 4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }

  async slice(start: number, end = this.size): Promise<TextValue> {
    start = Math.min(this.size, Math.max(0, start)); end = Math.min(this.size, Math.max(start, end));
    if (Number.isNaN(start) || Number.isNaN(end)) return TextValue.create([], this.budget, this.storage);
    if (typeof this.data === "string") {
      const source = this.data;
      return TextValue.create((function* () { let at = 0; for (const character of source) { if (at >= start && at < end) yield character; at++; } })(), this.budget);
    }
    const range = new TextValue({ storage: this.data.storage, start: this.data.start + start * 4 }, end - start, 0, this.budget);
    let bytes = 0;
    for await (const part of range.chunks()) for (const character of part) bytes += utf8Size(character.codePointAt(0)!);
    return new TextValue(range.data, range.size, bytes, this.budget);
  }

  async equals(other: TextValue): Promise<boolean> {
    if (this.size !== other.size) return false;
    const left = this.chunks(), right = other.chunks();
    try {
      let a = await left.next(), b = await right.next(), x = 0, y = 0;
      while (!a.done && !b.done) {
        const count = Math.min(a.value.length - x, b.value.length - y);
        const checkpoint = this.budget.tick(count); if (checkpoint) await checkpoint;
        if (a.value.slice(x, x + count) !== b.value.slice(y, y + count)) return false;
        x += count; y += count;
        if (x === a.value.length) { a = await left.next(); x = 0; }
        if (y === b.value.length) { b = await right.next(); y = 0; }
      }
      return !!a.done && !!b.done;
    } finally { await left.return(undefined); await right.return(undefined); }
  }

  async find(pattern: TextValue): Promise<number> {
    if (!pattern.size) return 0;
    if (pattern.size > this.size) return -1;
    if (typeof this.data === "string" && typeof pattern.data === "string") {
      const at = this.data.indexOf(pattern.data);
      if (at < 0) return -1;
      let count = 0;
      for (const ignored of this.data.slice(0, at)) count++;
      return count;
    }
    // A fixed small-pattern cache handles the common case without per-character I/O.
    if (pattern.size <= 4096) {
      const points = new Uint32Array(pattern.size), prefix = new Uint32Array(pattern.size);
      let at = 0;
      for await (const part of pattern.chunks()) for (const character of part) points[at++] = character.codePointAt(0)!;
      for (let index = 1, matched = 0; index < points.length; index++) {
        while (matched && points[index] !== points[matched]) matched = prefix[matched - 1]!;
        if (points[index] === points[matched]) matched++;
        prefix[index] = matched;
      }
      let position = 0, matched = 0;
      for await (const part of this.chunks()) for (const character of part) {
        const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint;
        const point = character.codePointAt(0)!;
        while (matched && point !== points[matched]) matched = prefix[matched - 1]!;
        if (point === points[matched]) matched++;
        if (matched === pattern.size) return position - pattern.size + 1;
        position++;
      }
      return -1;
    }
    const storage = this.storage ?? pattern.storage!;
    const prefix = storage.allocate(pattern.size * 8);
    const get = async (index: number): Promise<number> => {
      const bytes = await storage.read(prefix + index * 8, 8);
      return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
    };
    for (let index = 1, matched = 0; index < pattern.size; index++) {
      const point = await pattern.point(index);
      while (matched && point !== await pattern.point(matched)) matched = await get(matched - 1);
      if (point === await pattern.point(matched)) matched++;
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setFloat64(0, matched, true);
      await storage.write(prefix + index * 8, bytes);
    }
    let position = 0, matched = 0;
    for await (const part of this.chunks()) for (const character of part) {
      const point = character.codePointAt(0)!;
      while (matched && point !== await pattern.point(matched)) matched = await get(matched - 1);
      if (point === await pattern.point(matched)) matched++;
      if (matched === pattern.size) return position - pattern.size + 1;
      position++;
    }
    return -1;
  }

  async normalize(): Promise<TextValue> {
    const source = this.chunks();
    return TextValue.create((async function* () {
      let text = "", seen = false, pending = false;
      for await (const part of source) for (const character of part) {
        if (whitespace(character.codePointAt(0)!)) pending = seen;
        else { if (pending) text += " "; text += character; seen = true; pending = false; }
        if (text.length >= 4096) { yield text; text = ""; }
      }
      if (text) yield text;
    })(), this.budget, this.storage);
  }

  async translate(search: TextValue, replacement: TextValue): Promise<TextValue> {
    const storage = this.storage ?? search.storage ?? replacement.storage;
    const small = search.size <= 4096 || !storage ? new Map<number, number>() : undefined;
    const large = small ? undefined : new IntegerTable(storage!, 128);
    let index = 0;
    for await (const part of search.chunks()) for (const character of part) {
      const point = character.codePointAt(0)!;
      const existing = small ? small.get(point) : await large!.get(BigInt(point));
      if (existing === undefined) {
        const value = (await replacement.point(index) ?? -1) + 1;
        if (small) small.set(point, value); else await large!.set(BigInt(point), BigInt(value));
      }
      index++;
    }
    if (large) for await (const ignored of large.entries()) { const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint; }
    const source = this.chunks();
    return TextValue.create((async function* () {
      let text = "";
      for await (const part of source) for (const character of part) {
        const point = character.codePointAt(0)!;
        const value = small ? small.get(point) : await large!.get(BigInt(point));
        text += value === undefined ? character : Number(value) === 0 ? "" : String.fromCodePoint(Number(value) - 1);
        if (text.length >= 4096) { yield text; text = ""; }
      }
      if (text) yield text;
    })(), this.budget, storage);
  }

  async number(): Promise<number> {
    let phase: "leading" | "mantissa" | "exponent-start" | "exponent" | "trailing" = "leading";
    let negative = false, dot = false, digits = 0, fraction = 0, significant = 0;
    let exponent = 0, exponentNegative = false, exponentDigits = 0, hasExponent = false;
    let prefix = "", sticky = false;
    for await (const part of this.chunks()) for (const character of part) {
      const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint;
      const point = character.codePointAt(0)!;
      if (whitespace(point)) { if (phase !== "leading") phase = "trailing"; continue; }
      if (phase === "trailing") return NaN;
      if (phase === "leading") {
        phase = "mantissa";
        if (character === "-") { negative = true; continue; }
      }
      if (phase === "mantissa") {
        if (point >= 48 && point <= 57) {
          digits++; if (dot) fraction++;
          if (point !== 48 || significant) {
            significant++;
            // Every binary64 rounding boundary has at most 1075 significant
            // decimal digits. A longer fixed prefix plus a sticky bit preserves
            // which side of that boundary an arbitrarily long decimal occupies.
            if (prefix.length < 1100) prefix += character;
            else if (point !== 48) sticky = true;
          }
        } else if (character === "." && !dot) dot = true;
        else if ((character === "e" || character === "E") && digits) { hasExponent = true; phase = "exponent-start"; }
        else return NaN;
      } else {
        if (phase === "exponent-start") {
          phase = "exponent";
          if (character === "+" || character === "-") { exponentNegative = character === "-"; continue; }
        }
        if (point < 48 || point > 57) return NaN;
        exponentDigits++;
        exponent = Math.min(Number.MAX_SAFE_INTEGER, exponent * 10 + point - 48);
      }
    }
    if (!digits || hasExponent && !exponentDigits) return NaN;
    if (!significant) return negative ? -0 : 0;
    const power = (exponentNegative ? -exponent : exponent) + significant - fraction - 1;
    return Number(`${negative ? "-" : ""}${prefix[0]}.${prefix.slice(1)}${sticky ? "1" : ""}e${power}`);
  }
}

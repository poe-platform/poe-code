import { object, objectKeyIterator, objectSize, put, type Json } from "../structured/limits.js";
import { Decimal, numberText } from "../structured/numbers.js";
import type { YqOwnedWork } from "../structured/query-core.js";
import { YqLedger, yqCaps } from "./accounting.js";
import { YqError, limit } from "./errors.js";

type Table = Record<string, Json>;
type TableKind = "root" | "implicit" | "header" | "dotted" | "inline";
interface TableState { kind: TableKind; readonly depth: number; sealed: boolean; }

class TomlParser {
  #offset = 0;
  #line = 1;
  #column = 1;
  #pending = 0;
  readonly #tables = new WeakMap<Table, TableState>();
  readonly #arraysOfTables = new WeakSet<Json[]>();

  constructor(readonly source: string, readonly work: YqOwnedWork, readonly ledger: YqLedger) {}

  #syntax(): never { throw new YqError("input", "INPUT_TOML_SYNTAX", 5, undefined, this.#line, this.#column); }
  #conflict(): never { throw new YqError("schema", "SCHEMA_DUPLICATE_KEY", 5, undefined, this.#line, this.#column); }
  #schema(code: "SCHEMA_UNSAFE_INTEGER" | "SCHEMA_NONFINITE_NUMBER" | "SCHEMA_DECIMAL_RANGE"): never {
    throw new YqError("schema", code, 5, undefined, this.#line, this.#column);
  }
  #peek(distance = 0): string { return this.source[this.#offset + distance] ?? ""; }
  #take(): string {
    if (this.#offset >= this.source.length) this.#syntax();
    const point = this.source.codePointAt(this.#offset)!;
    if (point >= 0xd800 && point <= 0xdfff || point < 32 && point !== 9 && point !== 10 && point !== 13 || point === 127) this.#syntax();
    let value = String.fromCodePoint(point);
    this.#offset += value.length;
    this.#pending++;
    if (point === 13) {
      if (this.#peek() !== "\n") this.#syntax();
      this.#offset++;
      value = "\n";
    }
    if (value === "\n") { this.#line++; this.#column = 1; }
    else this.#column++;
    return value;
  }
  async #flush(): Promise<void> {
    if (this.#pending) { const units = this.#pending; this.#pending = 0; await this.work.charge(units); }
    this.work.assertOpen();
  }
  async #space(newlines: boolean): Promise<void> {
    while (true) {
      const character = this.#peek();
      if (character === " " || character === "\t" || newlines && (character === "\n" || character === "\r")) this.#take();
      else if (newlines && character === "#") {
        while (this.#peek() && this.#peek() !== "\n" && this.#peek() !== "\r") {
          this.#take();
          if (this.#pending >= 256) await this.#flush();
        }
      } else break;
      if (this.#pending >= 256) await this.#flush();
    }
  }
  async #lineEnd(): Promise<void> {
    await this.#space(false);
    if (this.#peek() === "#") {
      while (this.#peek() && this.#peek() !== "\n" && this.#peek() !== "\r") {
        this.#take();
        if (this.#pending >= 256) await this.#flush();
      }
    }
    if (this.#peek() === "\n" || this.#peek() === "\r") this.#take();
    else if (this.#peek()) this.#syntax();
  }
  #depth(depth: number): void { if (depth > yqCaps.maxDepth) throw limit("LIMIT_MAX_DEPTH"); }
  async #node(): Promise<void> {
    await this.#flush();
    await this.work.charge(1);
    this.work.assertOpen();
    this.ledger.admitNode();
  }
  async #table(kind: TableKind, depth: number): Promise<Table> {
    this.#depth(depth);
    await this.#node();
    this.ledger.admitValueBytes(2);
    const value = object();
    this.#tables.set(value, { kind, depth, sealed: false });
    return value;
  }
  async #array(depth: number): Promise<Json[]> {
    this.#depth(depth);
    await this.#node();
    this.ledger.admitValueBytes(2);
    return [];
  }
  async #scalar(value: Json): Promise<void> {
    await this.#node();
    if (typeof value !== "string") {
      const text = typeof value === "boolean" ? String(value) : numberText(value as number | Decimal);
      this.ledger.admitScalar(text.length);
      this.ledger.admitValueBytes(text.length);
      return;
    }
    let rawBytes = 0;
    let compactBytes = 2;
    let work = 0;
    for (const character of value) {
      const point = character.codePointAt(0)!;
      const bytes = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      rawBytes += bytes;
      compactBytes += point === 34 || point === 92 || [8, 9, 10, 12, 13].includes(point) ? 2 : point < 32 ? 6 : bytes;
      this.ledger.admitScalar(rawBytes);
      if (++work === 256) { await this.work.charge(work); this.work.assertOpen(); work = 0; }
    }
    if (work) await this.work.charge(work);
    this.work.assertOpen();
    this.ledger.admitValueBytes(compactBytes);
  }
  async #member(table: Table, key: string, value: Json): Promise<void> {
    if (Object.hasOwn(table, key)) this.#conflict();
    const size = objectSize(table);
    if (size >= yqCaps.maxCollectionSize) throw limit("LIMIT_MAX_COLLECTION_SIZE");
    await this.#scalar(key);
    this.ledger.admitValueBytes(size ? 2 : 1);
    this.work.assertOpen();
    put(table, key, value);
  }
  #append(array: Json[], value: Json): void {
    if (array.length >= yqCaps.maxCollectionSize) throw limit("LIMIT_MAX_COLLECTION_SIZE");
    if (array.length) this.ledger.admitValueBytes(1);
    this.work.assertOpen();
    array.push(value);
  }
  async #string(key = false): Promise<string> {
    const quote = this.#take();
    let multiline = false;
    if (!key && this.#peek() === quote && this.#peek(1) === quote) {
      this.#take(); this.#take(); multiline = true;
      if (this.#peek() === "\n" || this.#peek() === "\r") this.#take();
    }
    const parts: string[] = [];
    let part = "";
    let bytes = 0;
    const append = (value: string): void => {
      bytes += Buffer.byteLength(value);
      this.ledger.admitScalar(bytes);
      part += value;
      if (part.length >= 256) { parts.push(part); part = ""; }
    };
    while (this.#peek()) {
      const character = this.#take();
      if (character === quote) {
        if (!multiline) { parts.push(part); return parts.join(""); }
        let count = 1;
        while (count < 5 && this.#peek() === quote) { this.#take(); count++; }
        if (count >= 3) { append(quote.repeat(count - 3)); parts.push(part); return parts.join(""); }
        append(quote.repeat(count));
      } else if (character === "\n") {
        if (!multiline) this.#syntax();
        append(character);
      } else if (quote === '"' && character === "\\") {
        if (multiline && [" ", "\t", "\n", "\r"].includes(this.#peek())) {
          await this.#space(false);
          if (this.#peek() !== "\n" && this.#peek() !== "\r") this.#syntax();
          this.#take();
          while ([" ", "\t", "\n", "\r"].includes(this.#peek())) {
            this.#take();
            if (this.#pending >= 256) await this.#flush();
          }
        } else {
          const escape = this.#take();
          const simple: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
          if (Object.hasOwn(simple, escape)) append(simple[escape]!);
          else if (escape === "u" || escape === "U") {
            let point = 0;
            for (let index = 0; index < (escape === "u" ? 4 : 8); index++) {
              const digit = this.#digit(this.#take(), 16);
              if (digit < 0) this.#syntax();
              point = point * 16 + digit;
            }
            if (point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) this.#syntax();
            append(String.fromCodePoint(point));
          } else this.#syntax();
        }
      } else append(character);
      if (this.#pending >= 256) await this.#flush();
    }
    return this.#syntax();
  }
  #digit(character: string, base: number): number {
    const code = character.charCodeAt(0);
    const digit = code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 70 ? code - 55 : code >= 97 && code <= 102 ? code - 87 : -1;
    return digit >= 0 && digit < base ? digit : -1;
  }
  async #keyPath(): Promise<string[]> {
    const path: string[] = [];
    while (true) {
      await this.#space(false);
      let key: string;
      if (this.#peek() === '"' || this.#peek() === "'") key = await this.#string(true);
      else {
        const start = this.#offset;
        while (this.#peek()) {
          const code = this.#peek().charCodeAt(0);
          if (!(code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 95 || code === 45)) break;
          this.#take();
          if (this.#offset - start > yqCaps.maxScalarBytes) throw limit("LIMIT_MAX_SCALAR_BYTES");
          if (this.#pending >= 256) await this.#flush();
        }
        if (this.#offset === start) this.#syntax();
        key = this.source.slice(start, this.#offset);
      }
      if (path.length >= yqCaps.maxDepth) throw limit("LIMIT_MAX_DEPTH");
      path.push(key);
      await this.#space(false);
      if (this.#peek() !== ".") return path;
      this.#take();
    }
  }
  #state(table: Table): TableState {
    const state = this.#tables.get(table);
    if (!state) this.#conflict();
    return state;
  }
  async #parents(start: Table, path: readonly string[], kind: "implicit" | "dotted", allowAoT: boolean): Promise<Table> {
    let current = start;
    for (const key of path) {
      await this.work.charge(1); this.work.assertOpen();
      const parent = this.#state(current);
      if (parent.sealed) this.#conflict();
      let value = current[key];
      if (!Object.hasOwn(current, key)) {
        value = await this.#table(kind, parent.depth + 1);
        await this.#member(current, key, value);
      } else if (Array.isArray(value) && allowAoT && this.#arraysOfTables.has(value)) value = value.at(-1)!;
      if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Decimal) this.#conflict();
      const state = this.#state(value);
      if (state.sealed) this.#conflict();
      if (kind === "dotted" && state.kind === "header") this.#conflict();
      if (kind === "dotted" && state.kind === "implicit") state.kind = "dotted";
      current = value;
    }
    return current;
  }
  async #assignment(current: Table): Promise<void> {
    const path = await this.#keyPath();
    if (this.#take() !== "=") this.#syntax();
    await this.#space(false);
    const parent = await this.#parents(current, path.slice(0, -1), "dotted", false);
    if (this.#state(parent).sealed || Object.hasOwn(parent, path.at(-1)!)) this.#conflict();
    if (objectSize(parent) >= yqCaps.maxCollectionSize) throw limit("LIMIT_MAX_COLLECTION_SIZE");
    const value = await this.#value(this.#state(parent).depth + 1);
    await this.#member(parent, path.at(-1)!, value);
  }
  async #header(root: Table): Promise<Table> {
    this.#take();
    const array = this.#peek() === "[";
    if (array) this.#take();
    const path = await this.#keyPath();
    if (this.#take() !== "]" || array && this.#take() !== "]") this.#syntax();
    await this.#lineEnd();
    const parent = await this.#parents(root, path.slice(0, -1), "implicit", true);
    const key = path.at(-1)!;
    const parentState = this.#state(parent);
    if (parentState.sealed) this.#conflict();
    const exists = Object.hasOwn(parent, key);
    const existing = parent[key];
    if (array) {
      let values: Json[];
      if (exists) {
        if (!Array.isArray(existing) || !this.#arraysOfTables.has(existing)) this.#conflict();
        values = existing;
      } else {
        values = await this.#array(parentState.depth + 1);
        this.#arraysOfTables.add(values);
        await this.#member(parent, key, values);
      }
      if (values.length >= yqCaps.maxCollectionSize) throw limit("LIMIT_MAX_COLLECTION_SIZE");
      const table = await this.#table("header", parentState.depth + 2);
      this.#append(values, table);
      return table;
    }
    if (exists) {
      if (typeof existing !== "object" || existing === null || Array.isArray(existing) || existing instanceof Decimal) this.#conflict();
      const state = this.#state(existing);
      if (state.kind !== "implicit" || state.sealed) this.#conflict();
      state.kind = "header";
      return existing;
    }
    const table = await this.#table("header", parentState.depth + 1);
    await this.#member(parent, key, table);
    return table;
  }
  async #seal(table: Table): Promise<void> {
    const pending: Table[] = [table];
    while (pending.length) {
      const current = pending.pop()!;
      await this.work.charge(1); this.work.assertOpen();
      this.#state(current).sealed = true;
      for (const key of objectKeyIterator(current)) {
        await this.work.charge(1); this.work.assertOpen();
        const value = current[key];
        if (typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Decimal)) pending.push(value);
      }
    }
  }
  async #value(depth: number): Promise<Json> {
    this.#depth(depth);
    const character = this.#peek();
    if (character === '"' || character === "'") {
      const value = await this.#string();
      await this.#scalar(value);
      return value;
    }
    if (character === "[") {
      this.#take();
      const result = await this.#array(depth);
      await this.#space(true);
      while (this.#peek() !== "]") {
        if (!this.#peek()) this.#syntax();
        if (result.length >= yqCaps.maxCollectionSize) throw limit("LIMIT_MAX_COLLECTION_SIZE");
        const value = await this.#value(depth + 1);
        this.#append(result, value);
        await this.#space(true);
        if (this.#peek() !== ",") break;
        this.#take(); await this.#space(true);
      }
      if (this.#take() !== "]") this.#syntax();
      return result;
    }
    if (character === "{") {
      this.#take();
      const result = await this.#table("inline", depth);
      await this.#space(false);
      if (this.#peek() !== "}") {
        while (true) {
          await this.#assignment(result);
          await this.#space(false);
          if (this.#peek() !== ",") break;
          this.#take(); await this.#space(false);
          if (this.#peek() === "}") this.#syntax();
        }
      }
      if (this.#take() !== "}") this.#syntax();
      await this.#seal(result);
      return result;
    }
    const start = this.#offset;
    while (this.#peek()) {
      const next = this.#peek();
      if (" \t\r\n#,]}".includes(next)) {
        if (next === " " && this.#offset - start === 10 && this.source[start + 4] === "-" && this.source[start + 7] === "-" && this.#digit(this.#peek(1), 10) >= 0) this.#take();
        else break;
      } else this.#take();
      if (this.#offset - start > yqCaps.maxScalarBytes) throw limit("LIMIT_MAX_SCALAR_BYTES");
      if (this.#pending >= 256) await this.#flush();
    }
    if (this.#offset === start) this.#syntax();
    const raw = this.source.slice(start, this.#offset);
    await this.#flush();
    let value: Json;
    if (raw === "true" || raw === "false") value = raw === "true";
    else if (raw.length >= 8 && (raw[2] === ":" || raw[4] === "-" && raw[7] === "-")) {
      await this.#date(raw); value = raw;
    } else value = await this.#number(raw);
    await this.#scalar(value);
    return value;
  }
  async #number(raw: string): Promise<number | Decimal> {
    let start = 0;
    const negative = raw[0] === "-";
    if (negative || raw[0] === "+") start++;
    const unsigned = raw.slice(start);
    if (unsigned === "inf" || unsigned === "nan") this.#schema("SCHEMA_NONFINITE_NUMBER");
    let base = 10;
    if (unsigned.startsWith("0x")) base = 16;
    else if (unsigned.startsWith("0o")) base = 8;
    else if (unsigned.startsWith("0b")) base = 2;
    if (base !== 10) {
      if (start) this.#syntax();
      let value = 0;
      let previousDigit = false;
      if (raw.length <= 2) this.#syntax();
      for (let index = 2; index < raw.length; index++) {
        const character = raw[index]!;
        if (character === "_") { if (!previousDigit || this.#digit(raw[index + 1] ?? "", base) < 0) this.#syntax(); previousDigit = false; }
        else {
          const digit = this.#digit(character, base);
          if (digit < 0) this.#syntax();
          if (value > Math.floor((Number.MAX_SAFE_INTEGER - digit) / base)) this.#schema("SCHEMA_UNSAFE_INTEGER");
          value = value * base + digit; previousDigit = true;
        }
        if (index % 256 === 0) { await this.work.charge(256); this.work.assertOpen(); }
      }
      return value;
    }
    let clean = "";
    let integerDigits = 0;
    let fractionDigits = 0;
    let exponentDigits = 0;
    let exponentValue = 0;
    let exponentNegative = false;
    let state: "integer" | "fraction" | "exponent" = "integer";
    let previousDigit = false;
    let coefficient = "";
    for (let index = start; index < raw.length; index++) {
      const character = raw[index]!;
      const digit = this.#digit(character, 10);
      if (digit >= 0) {
        clean += character; previousDigit = true;
        if (state === "integer") { integerDigits++; coefficient += character; }
        else if (state === "fraction") { fractionDigits++; coefficient += character; }
        else { exponentDigits++; if (exponentValue > 1_147_483_646) this.#schema("SCHEMA_DECIMAL_RANGE"); exponentValue = exponentValue * 10 + digit; }
      } else if (character === "_") {
        if (!previousDigit || this.#digit(raw[index + 1] ?? "", 10) < 0) this.#syntax();
        previousDigit = false;
      } else if (character === "." && state === "integer" && previousDigit) {
        state = "fraction"; previousDigit = false; clean += character;
      } else if ((character === "e" || character === "E") && state !== "exponent" && previousDigit) {
        state = "exponent"; previousDigit = false; clean += "e";
        if (raw[index + 1] === "+" || raw[index + 1] === "-") { exponentNegative = raw[index + 1] === "-"; clean += raw[++index]; }
      } else this.#syntax();
      if ((index - start + 1) % 256 === 0) { await this.work.charge(256); this.work.assertOpen(); }
    }
    if (!previousDigit || !integerDigits || integerDigits > 1 && unsigned[0] === "0" || state === "fraction" && !fractionDigits || state === "exponent" && !exponentDigits) this.#syntax();
    const signed = (negative ? "-" : "") + clean;
    const value = Number(signed);
    if (!Number.isFinite(value)) this.#schema("SCHEMA_NONFINITE_NUMBER");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) this.#schema("SCHEMA_UNSAFE_INTEGER");
    if (state === "integer") return value;
    let exponent = (exponentNegative ? -exponentValue : exponentValue) - fractionDigits;
    if (exponent < -1_147_483_646 || exponent > 999_999_999) this.#schema("SCHEMA_DECIMAL_RANGE");
    let first = 0;
    while (first < coefficient.length - 1 && coefficient[first] === "0") {
      first++; if (first % 256 === 0) { await this.work.charge(256); this.work.assertOpen(); }
    }
    let last = coefficient.length;
    while (last > first + 1 && coefficient[last - 1] === "0") {
      last--; exponent++; if ((coefficient.length - last) % 256 === 0) { await this.work.charge(256); this.work.assertOpen(); }
    }
    const digits = coefficient.slice(first, last);
    if (digits !== "0" && exponent >= 0 && (digits.length + exponent > 16 || !Number.isSafeInteger(Number(`${digits}e${exponent}`)))) this.#schema("SCHEMA_UNSAFE_INTEGER");
    return new Decimal(digits, exponent, negative, signed, value);
  }
  async #date(raw: string): Promise<void> {
    const digits = (offset: number, length: number): number => {
      let value = 0;
      for (let index = offset; index < offset + length; index++) {
        const digit = this.#digit(raw[index] ?? "", 10);
        if (digit < 0) this.#syntax();
        value = value * 10 + digit;
      }
      return value;
    };
    let offset = 0;
    const date = raw[4] === "-" && raw[7] === "-";
    if (date) {
      const year = digits(0, 4), month = digits(5, 2), day = digits(8, 2);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) this.#syntax();
      if (raw.length === 10) return;
      if (!["T", "t", " "].includes(raw[10]!)) this.#syntax();
      offset = 11;
    }
    if (raw[offset + 2] !== ":" || raw[offset + 5] !== ":" || digits(offset, 2) > 23 || digits(offset + 3, 2) > 59 || digits(offset + 6, 2) > 59) this.#syntax();
    offset += 8;
    if (raw[offset] === ".") {
      const start = ++offset;
      while (this.#digit(raw[offset] ?? "", 10) >= 0) {
        offset++; if ((offset - start) % 256 === 0) { await this.work.charge(256); this.work.assertOpen(); }
      }
      if (offset === start) this.#syntax();
    }
    if (offset === raw.length) return;
    if (!date) this.#syntax();
    if (raw[offset] === "Z" || raw[offset] === "z") offset++;
    else if (raw[offset] === "+" || raw[offset] === "-") {
      if (raw[offset + 3] !== ":" || digits(offset + 1, 2) > 23 || digits(offset + 4, 2) > 59) this.#syntax();
      offset += 6;
    } else this.#syntax();
    if (offset !== raw.length) this.#syntax();
  }
  async parse(): Promise<Json> {
    if (this.source.charCodeAt(0) === 0xfeff) this.#syntax();
    const root = await this.#table("root", 1);
    let current = root;
    while (true) {
      await this.#space(true);
      if (!this.#peek()) break;
      if (this.#peek() === "[") current = await this.#header(root);
      else { await this.#assignment(current); await this.#lineEnd(); }
    }
    await this.#flush();
    return root;
  }
}

export async function parseTomlDocument(text: string, work: YqOwnedWork, ledger: YqLedger, rawBytes: number): Promise<Json> {
  work.assertOpen();
  ledger.beginDocument(rawBytes);
  return new TomlParser(text, work, ledger).parse();
}

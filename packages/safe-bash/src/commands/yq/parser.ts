import { object, objectKeys, put, wellFormed, type Json } from "../structured/limits.js";
import { Decimal, isNumber, numberText } from "../structured/numbers.js";
import type { YqOwnedWork } from "../structured/query-core.js";
import { aliasFailure, copyAlias, YqLedger, yqCaps } from "./accounting.js";
import { YqError, limit, type YqCode } from "./errors.js";

type ScalarStyle = "plain" | "single" | "double" | "literal" | "folded";

interface ParsedNode {
  readonly value: Json;
  readonly style?: ScalarStyle;
  readonly explicitTag?: string;
  readonly raw?: string;
}

interface SourceLine {
  readonly text: string;
  readonly number: number;
  readonly rawBytes: number;
  readonly hadBreak: boolean;
}

interface RawDocument {
  readonly lines: SourceLine[];
  readonly explicit: boolean;
  readonly rawBytes: number;
}

interface AnchorRecord {
  readonly name: string;
  pending: boolean;
  value?: Json;
}

interface BlockScalarPart {
  readonly lineText: string;
  readonly contentIndent: number;
  readonly empty: boolean;
  readonly moreIndented: boolean;
  readonly hadBreak: boolean;
}

const integerPattern = /^(?:[+-]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$/u;
const floatPattern = /^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|\.(?:inf|Inf|INF|nan|NaN|NAN))$/u;

function syntax(line?: number, column?: number): YqError {
  return new YqError("input", "INPUT_YAML_SYNTAX", 5, undefined, line, column);
}

function structure(line?: number, column?: number): YqError {
  return new YqError("input", "INPUT_DOCUMENT_STRUCTURE", 5, undefined, line, column);
}

function schema(code: YqCode, line?: number, column?: number): YqError {
  return new YqError("schema", code, 5, undefined, line, column);
}

function countCodePoints(text: string): number {
  let count = 0;
  for (const unused of text) {
    void unused;
    count++;
  }
  return count;
}

function utf8Width(codePoint: number): number {
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}

function compactStringBytes(text: string): number {
  let bytes = 2;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point === 0x22 || point === 0x5c || point === 0x08 || point === 0x0c || point === 0x0a || point === 0x0d || point === 0x09) bytes += 2;
    else if (point < 0x20) bytes += 6;
    else bytes += Buffer.byteLength(character);
  }
  return bytes;
}

function compactScalarBytes(value: Json): number {
  if (typeof value === "string") return compactStringBytes(value);
  if (isNumber(value)) return Buffer.byteLength(numberText(value));
  return Buffer.byteLength(JSON.stringify(value));
}

function indentation(line: string): number {
  let index = 0;
  while (line[index] === " ") index++;
  if (line[index] === "\t") throw syntax();
  return index;
}

function stripComment(text: string): string {
  let single = false;
  let double = false;
  let escaped = false;
  let flowDepth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (double) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') double = false;
      continue;
    }
    if (single) {
      if (character === "'" && text[index + 1] === "'") index++;
      else if (character === "'") single = false;
      continue;
    }
    if (character === '"') double = true;
    else if (character === "'") single = true;
    else if (character === "[" || character === "{") flowDepth++;
    else if (character === "]" || character === "}") flowDepth--;
    else if (character === "#" && (index === 0 || /[ \t\r\n]/u.test(text[index - 1]!))) return text.slice(0, index).trimEnd();
  }
  void flowDepth;
  return text.trimEnd();
}

function mappingColon(text: string, flow = false): number {
  let single = false;
  let double = false;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (double) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') double = false;
      continue;
    }
    if (single) {
      if (character === "'" && text[index + 1] === "'") index++;
      else if (character === "'") single = false;
      continue;
    }
    if (character === '"') double = true;
    else if (character === "'") single = true;
    else if (character === "[" || character === "{") depth++;
    else if (character === "]" || character === "}") depth--;
    else if (character === ":" && depth === 0 && (flow || index + 1 === text.length || /[ \t]/u.test(text[index + 1]!))) return index;
  }
  return -1;
}

function checkedExponent(text: string): number {
  let index = 0;
  let negative = false;
  if (text[index] === "+" || text[index] === "-") {
    negative = text[index] === "-";
    index++;
  }
  let value = 0;
  for (; index < text.length; index++) {
    const digit = text.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) throw syntax();
    value = value > 2_000_000_000 ? 2_000_000_001 : value * 10 + digit;
  }
  return negative ? -value : value;
}

function decimalText(digits: string, exponent: number, negative: boolean): string {
  const sign = negative ? "-" : "";
  const adjusted = exponent + digits.length - 1;
  if (exponent > 0 || adjusted < -6) {
    return `${sign}${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}E${adjusted >= 0 ? "+" : ""}${adjusted}`;
  }
  const point = digits.length + exponent;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  return `${sign}${digits.slice(0, point)}${point < digits.length ? `.${digits.slice(point)}` : ""}`;
}

function exactSafeIntegral(digits: string, exponent: number): boolean {
  if (digits === "0" || exponent < 0) return true;
  const length = digits.length + exponent;
  if (length < 16) return true;
  if (length > 16) return false;
  const boundary = "9007199254740991";
  for (let index = 0; index < digits.length; index++) {
    if (digits[index]! < boundary[index]!) return true;
    if (digits[index]! > boundary[index]!) return false;
  }
  for (let index = digits.length; index < boundary.length; index++) if (boundary[index] !== "0") return true;
  return true;
}

function parseDecimal(raw: string): Decimal {
  const negative = raw[0] === "-";
  const unsigned = raw[0] === "+" || raw[0] === "-" ? raw.slice(1) : raw;
  const exponentMarker = unsigned.search(/[eE]/u);
  const coefficient = exponentMarker < 0 ? unsigned : unsigned.slice(0, exponentMarker);
  const explicit = exponentMarker < 0 ? 0 : checkedExponent(unsigned.slice(exponentMarker + 1));
  const point = coefficient.indexOf(".");
  const fractional = point < 0 ? 0 : coefficient.length - point - 1;
  let exponent = explicit - fractional;
  let digits = coefficient.replace(".", "").replace(/^0+/u, "") || "0";
  if (digits !== "0") {
    let trailing = 0;
    while (digits.length - trailing > 1 && digits[digits.length - trailing - 1] === "0") trailing++;
    if (trailing > 0) {
      digits = digits.slice(0, -trailing);
      exponent += trailing;
    }
  }
  if (exponent < -1_147_483_646 || exponent > 999_999_999) throw schema("SCHEMA_DECIMAL_RANGE");
  if (!exactSafeIntegral(digits, exponent)) throw schema("SCHEMA_UNSAFE_INTEGER");
  const text = decimalText(digits, exponent, negative);
  const double = Number(`${negative ? "-" : ""}${digits}e${exponent}`);
  if (!Number.isFinite(double)) throw schema("SCHEMA_NONFINITE_NUMBER");
  if (Number.isInteger(double) && !Number.isSafeInteger(double)) throw schema("SCHEMA_UNSAFE_INTEGER");
  return new Decimal(digits, exponent, negative, text, double);
}

function parseBasedInteger(raw: string): number {
  const negative = raw[0] === "-";
  const unsigned = raw[0] === "+" || raw[0] === "-" ? raw.slice(1) : raw;
  const base = unsigned.startsWith("0x") ? 16 : unsigned.startsWith("0o") ? 8 : 10;
  const digits = base === 10 ? unsigned : unsigned.slice(2);
  let value = 0;
  for (const character of digits) {
    const digit = Number.parseInt(character, base);
    if (value > Math.floor((Number.MAX_SAFE_INTEGER - digit) / base)) throw schema("SCHEMA_UNSAFE_INTEGER");
    value = value * base + digit;
  }
  return negative ? -value : value;
}

function scalarFromPlain(raw: string, explicitTag?: string): Json {
  if (explicitTag === "str") return raw;
  const nullMatch = /^(?:~|null|Null|NULL)$/u.test(raw);
  const boolMatch = /^(?:true|True|TRUE|false|False|FALSE)$/u.test(raw);
  const intMatch = integerPattern.test(raw);
  const floatMatch = floatPattern.test(raw);
  if (explicitTag === "null") {
    if (!nullMatch) throw schema("SCHEMA_TAG_LEXEME_MISMATCH");
    return null;
  }
  if (explicitTag === "bool") {
    if (!boolMatch) throw schema("SCHEMA_TAG_LEXEME_MISMATCH");
    return /^true$/iu.test(raw);
  }
  if (explicitTag === "int") {
    if (!intMatch) throw schema("SCHEMA_TAG_LEXEME_MISMATCH");
    return parseBasedInteger(raw);
  }
  if (explicitTag === "float") {
    if (!(floatMatch || intMatch && /^[+-]?[0-9]+$/u.test(raw))) throw schema("SCHEMA_TAG_LEXEME_MISMATCH");
    if (/^[+-]?\.(?:inf|Inf|INF|nan|NaN|NAN)$/u.test(raw)) throw schema("SCHEMA_NONFINITE_NUMBER");
    return parseDecimal(raw);
  }
  if (nullMatch) return null;
  if (boolMatch) return /^true$/iu.test(raw);
  if (intMatch) return parseBasedInteger(raw);
  if (floatMatch) {
    if (/^[+-]?\.(?:inf|Inf|INF|nan|NaN|NAN)$/u.test(raw)) throw schema("SCHEMA_NONFINITE_NUMBER");
    return parseDecimal(raw);
  }
  return raw;
}

function normalizeTag(raw: string): string {
  const expanded = raw.startsWith("!!") ? `tag:yaml.org,2002:${raw.slice(2)}` : raw.startsWith("!<") && raw.endsWith(">") ? raw.slice(2, -1) : raw;
  if (expanded === "!") throw schema("SCHEMA_UNSUPPORTED_TAG");
  const prefix = "tag:yaml.org,2002:";
  if (!expanded.startsWith(prefix)) throw schema("SCHEMA_UNSUPPORTED_TAG");
  const name = expanded.slice(prefix.length);
  if (!["map", "seq", "str", "null", "bool", "int", "float"].includes(name)) throw schema("SCHEMA_UNSUPPORTED_TAG");
  return name;
}

function decodeDouble(raw: string): string {
  let result = "";
  for (let index = 1; index < raw.length - 1; index++) {
    const character = raw[index]!;
    if (character === "\n" || character === "\r") {
      if (character === "\r" && raw[index + 1] === "\n") index++;
      while (raw[index + 1] === " " || raw[index + 1] === "\t") index++;
      result += " ";
      continue;
    }
    if (character !== "\\") {
      const codePoint = character.codePointAt(0)!;
      if (codePoint === 0) throw syntax();
      result += character;
      if (codePoint > 0xffff) index++;
      continue;
    }
    const escape = raw[++index];
    if (escape === undefined) throw syntax();
    const simple: Record<string, string> = {
      "0": "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\x0b", f: "\f", r: "\r",
      e: "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\u0085", _: "\u00a0", L: "\u2028", P: "\u2029",
    };
    if (Object.hasOwn(simple, escape)) {
      result += simple[escape]!;
      continue;
    }
    if (escape === "\n" || escape === "\r") {
      if (escape === "\r" && raw[index + 1] === "\n") index++;
      while (raw[index + 1] === " " || raw[index + 1] === "\t") index++;
      continue;
    }
    const digits = escape === "x" ? 2 : escape === "u" ? 4 : escape === "U" ? 8 : 0;
    if (digits === 0) throw syntax();
    const hex = raw.slice(index + 1, index + 1 + digits);
    if (hex.length !== digits || !/^[0-9a-fA-F]+$/u.test(hex)) throw syntax();
    let codePoint = Number.parseInt(hex, 16);
    index += digits;
    if (escape === "u" && codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = raw.slice(index + 1, index + 7);
      if (!/^\\u[0-9a-fA-F]{4}$/u.test(next)) throw syntax();
      const low = Number.parseInt(next.slice(2), 16);
      if (low < 0xdc00 || low > 0xdfff) throw syntax();
      codePoint = 0x10000 + (codePoint - 0xd800) * 0x400 + low - 0xdc00;
      index += 6;
    } else if (codePoint >= 0xd800 && codePoint <= 0xdfff) throw syntax();
    if (codePoint > 0x10ffff) throw syntax();
    result += String.fromCodePoint(codePoint);
  }
  if (!wellFormed(result)) throw syntax();
  return result;
}

function projectDoubleBytes(raw: string, start = 0, end = raw.length): number {
  let bytes = 0;
  for (let index = start + 1; index < end - 1; index++) {
    const character = raw[index]!;
    if (character === "\n" || character === "\r") {
      if (character === "\r" && raw[index + 1] === "\n") index++;
      while (raw[index + 1] === " " || raw[index + 1] === "\t") index++;
      bytes++;
      continue;
    }
    if (character !== "\\") {
      const codePoint = character.codePointAt(0)!;
      if (codePoint === 0) throw syntax();
      bytes += utf8Width(codePoint);
      if (codePoint > 0xffff) index++;
      continue;
    }
    const escape = raw[++index];
    if (escape === undefined) throw syntax();
    const simpleWidths: Readonly<Record<string, number>> = {
      "0": 1, a: 1, b: 1, t: 1, "\t": 1, n: 1, v: 1, f: 1, r: 1,
      e: 1, " ": 1, '"': 1, "/": 1, "\\": 1, N: 2, _: 2, L: 3, P: 3,
    };
    if (Object.hasOwn(simpleWidths, escape)) {
      bytes += simpleWidths[escape]!;
      continue;
    }
    if (escape === "\n" || escape === "\r") {
      if (escape === "\r" && raw[index + 1] === "\n") index++;
      while (raw[index + 1] === " " || raw[index + 1] === "\t") index++;
      continue;
    }
    const digits = escape === "x" ? 2 : escape === "u" ? 4 : escape === "U" ? 8 : 0;
    if (digits === 0) throw syntax();
    const hex = raw.slice(index + 1, index + 1 + digits);
    if (hex.length !== digits || !/^[0-9a-fA-F]+$/u.test(hex)) throw syntax();
    let codePoint = Number.parseInt(hex, 16);
    index += digits;
    if (escape === "u" && codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = raw.slice(index + 1, index + 7);
      if (!/^\\u[0-9a-fA-F]{4}$/u.test(next)) throw syntax();
      const low = Number.parseInt(next.slice(2), 16);
      if (low < 0xdc00 || low > 0xdfff) throw syntax();
      codePoint = 0x10000 + (codePoint - 0xd800) * 0x400 + low - 0xdc00;
      index += 6;
    } else if (codePoint >= 0xd800 && codePoint <= 0xdfff) throw syntax();
    if (codePoint > 0x10ffff) throw syntax();
    bytes += utf8Width(codePoint);
  }
  return bytes;
}

function decodeSingle(raw: string): string {
  const inner = raw.slice(1, -1);
  return inner.replace(/''/gu, "'").replace(/\r\n|\r|\n[ \t]*/gu, " ");
}

function projectSingleBytes(raw: string, start = 0, end = raw.length): number {
  let bytes = 0;
  for (let index = start + 1; index < end - 1; index++) {
    const character = raw[index]!;
    if (character === "'" && raw[index + 1] === "'") {
      bytes++;
      index++;
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && raw[index + 1] === "\n") index++;
      if (character === "\n" || raw[index] === "\n") while (raw[index + 1] === " " || raw[index + 1] === "\t") index++;
      bytes++;
    } else {
      const codePoint = character.codePointAt(0)!;
      bytes += utf8Width(codePoint);
      if (codePoint > 0xffff) index++;
    }
  }
  return bytes;
}

function plainBounds(source: string, start: number, end: number): readonly [number, number] {
  while (start < end && /\s/u.test(source[start]!)) start++;
  while (end > start && /\s/u.test(source[end - 1]!)) end--;
  return [start, end];
}

function projectPlainBytes(source: string, start: number, end: number): number {
  [start, end] = plainBounds(source, start, end);
  let bytes = 0;
  for (let index = start; index < end;) {
    if (source[index] === "\n") {
      index++;
      while (index < end && (source[index] === " " || source[index] === "\t")) index++;
      bytes++;
      continue;
    }
    const codePoint = source.codePointAt(index)!;
    bytes += utf8Width(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return bytes;
}

function blockPartText(part: BlockScalarPart): string {
  return part.empty ? "" : part.lineText.slice(part.contentIndent);
}

function blockPartBytes(part: BlockScalarPart): number {
  if (part.empty) return 0;
  let bytes = 0;
  for (let index = part.contentIndent; index < part.lineText.length;) {
    const codePoint = part.lineText.codePointAt(index)!;
    bytes += utf8Width(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return bytes;
}

function blockScalarUnchomped(parts: readonly BlockScalarPart[], style: "literal" | "folded"): string {
  if (style === "literal") {
    let value = parts.map(blockPartText).join("\n");
    if (parts.at(-1)?.hadBreak) value += "\n";
    return value;
  }
  let value = "";
  for (let index = 0; index < parts.length; index++) {
    const current = parts[index]!;
    value += blockPartText(current);
    if (index < parts.length - 1) {
      const next = parts[index + 1]!;
      if (current.empty) value += next.empty ? "\n" : "";
      else value += next.empty || current.moreIndented || next.moreIndented ? "\n" : " ";
    } else if (current.hadBreak) value += "\n";
  }
  return value;
}

function projectBlockScalarBytes(parts: readonly BlockScalarPart[], style: "literal" | "folded", chomping: string): number {
  let bytes = 0;
  let trailingBreaks = 0;
  const addPart = (part: BlockScalarPart): void => {
    bytes += blockPartBytes(part);
    if (!part.empty) trailingBreaks = 0;
  };
  const addBreak = (): void => {
    bytes++;
    trailingBreaks++;
  };
  if (style === "literal") {
    for (let index = 0; index < parts.length; index++) {
      if (index > 0) addBreak();
      addPart(parts[index]!);
    }
    if (parts.at(-1)?.hadBreak) addBreak();
  } else {
    for (let index = 0; index < parts.length; index++) {
      const current = parts[index]!;
      addPart(current);
      if (index < parts.length - 1) {
        const next = parts[index + 1]!;
        if (current.empty && next.empty || !current.empty && (next.empty || current.moreIndented || next.moreIndented)) addBreak();
        else if (!current.empty) {
          bytes++;
          trailingBreaks = 0;
        }
      } else if (current.hadBreak) addBreak();
    }
  }
  if (chomping === "+") return bytes;
  const hasContent = parts.some(item => !item.empty);
  return bytes - trailingBreaks + (chomping === "clip" && hasContent && parts.at(-1)?.hadBreak ? 1 : 0);
}

function buildBlockScalar(parts: readonly BlockScalarPart[], style: "literal" | "folded", chomping: string): string {
  let value = blockScalarUnchomped(parts, style);
  const hasContent = parts.some(item => !item.empty);
  if (chomping === "clip") value = hasContent && parts.at(-1)?.hadBreak ? `${value.replace(/\n+$/u, "")}\n` : value.replace(/\n+$/u, "");
  if (chomping === "-") value = value.replace(/\n+$/u, "");
  return value;
}

class FlowParser {
  #position = 0;

  constructor(
    readonly source: string,
    readonly composer: Composer,
    readonly line: number,
  ) {}

  async parse(): Promise<ParsedNode> {
    const node = await this.#node();
    this.#space();
    if (this.#position !== this.source.length) throw syntax(this.line, this.#position + 1);
    return node;
  }

  async #node(keyMode = false): Promise<ParsedNode> {
    this.#space();
    let tag: string | undefined;
    let anchor: string | undefined;
    while (true) {
      if (this.source.startsWith("!!", this.#position)) {
        if (tag !== undefined) throw syntax(this.line, this.#position + 1);
        const match = /^!![^\s,\[\]{}]+/u.exec(this.source.slice(this.#position));
        if (!match) throw syntax(this.line, this.#position + 1);
        tag = normalizeTag(match[0]);
        this.#position += match[0].length;
        this.#space();
      } else if (this.source.startsWith("!<", this.#position)) {
        if (tag !== undefined) throw syntax(this.line, this.#position + 1);
        const end = this.source.indexOf(">", this.#position + 2);
        if (end < 0) throw syntax(this.line, this.#position + 1);
        tag = normalizeTag(this.source.slice(this.#position, end + 1));
        this.#position = end + 1;
        this.#space();
      } else if (this.source[this.#position] === "!") {
        throw schema("SCHEMA_UNSUPPORTED_TAG", this.line, this.#position + 1);
      } else if (this.source[this.#position] === "&") {
        if (anchor !== undefined) throw syntax(this.line, this.#position + 1);
        const match = /^&([^\s,\[\]{}]+)/u.exec(this.source.slice(this.#position));
        if (!match) throw syntax(this.line, this.#position + 1);
        anchor = match[1]!;
        this.#position += match[0].length;
        this.#space();
      } else break;
    }
    const record = anchor === undefined ? undefined : this.composer.beginAnchor(anchor);
    let parsed: ParsedNode;
    const character = this.source[this.#position];
    if (character === "[") parsed = await this.#sequence();
    else if (character === "{") parsed = await this.#mapping();
    else if (character === '"' || character === "'") parsed = await this.#quoted();
    else if (character === "*") parsed = await this.#alias();
    else if (character === undefined && tag !== undefined) {
      await this.composer.scalar("", null);
      parsed = { value: null, style: "plain", raw: "" };
    } else parsed = await this.#plain(keyMode);
    parsed = await this.composer.applyTag(parsed, tag);
    if (record) this.composer.completeAnchor(record, parsed.value);
    return { ...parsed, ...(tag === undefined ? {} : { explicitTag: tag }) };
  }

  async #sequence(): Promise<ParsedNode> {
    this.#position++;
    await this.composer.node();
    this.composer.collection();
    const result: Json[] = [];
    this.#space();
    if (this.source[this.#position] === "]") {
      this.#position++;
      return { value: result };
    }
    while (true) {
      this.composer.member(result.length + 1);
      this.composer.member(1);
      const start = this.#position;
      let value = await this.#node();
      this.#space();
      if (this.source[this.#position] === ":") {
        if (this.source.slice(start, this.#position).includes("\n")) throw syntax(this.line, this.#position + 1);
        this.#position++;
        const mapped = await this.#node();
        await this.composer.node();
        this.composer.collection();
        const pair = object();
        this.composer.mappingEntry(pair, value, mapped.value, true, true);
        value = { value: pair };
      }
      result.push(value.value);
      this.#space();
      if (this.source[this.#position] === "]") {
        this.#position++;
        return { value: result };
      }
      if (this.source[this.#position] !== ",") throw syntax(this.line, this.#position + 1);
      this.#position++;
      this.#space();
      if (this.source[this.#position] === "]") {
        this.#position++;
        return { value: result };
      }
    }
  }

  async #mapping(): Promise<ParsedNode> {
    this.#position++;
    await this.composer.node();
    this.composer.collection();
    const result = object();
    let members = 0;
    this.#space();
    if (this.source[this.#position] === "}") {
      this.#position++;
      return { value: result };
    }
    while (true) {
      this.composer.member(++members);
      const key = await this.#node(true);
      this.#space();
      if (this.source[this.#position] !== ":") throw syntax(this.line, this.#position + 1);
      this.#position++;
      const value = await this.#node();
      this.composer.mappingEntry(result, key, value.value, true, true);
      this.#space();
      if (this.source[this.#position] === "}") {
        this.#position++;
        return { value: result };
      }
      if (this.source[this.#position] !== ",") throw syntax(this.line, this.#position + 1);
      this.#position++;
      this.#space();
      if (this.source[this.#position] === "}") {
        this.#position++;
        return { value: result };
      }
    }
  }

  async #quoted(): Promise<ParsedNode> {
    const quote = this.source[this.#position]!;
    const start = this.#position++;
    let escaped = false;
    while (this.#position < this.source.length) {
      const character = this.source[this.#position++]!;
      if (quote === '"') {
        if (!escaped && character === '"') break;
        if (!escaped && character === "\\") escaped = true;
        else escaped = false;
      } else if (character === "'" && this.source[this.#position] === "'") this.#position++;
      else if (character === "'") break;
    }
    if (this.source[this.#position - 1] !== quote) throw syntax(this.line, start + 1);
    const projectedBytes = quote === '"'
      ? projectDoubleBytes(this.source, start, this.#position)
      : projectSingleBytes(this.source, start, this.#position);
    this.composer.admitScalar(projectedBytes);
    const raw = this.source.slice(start, this.#position);
    const value = quote === '"' ? decodeDouble(raw) : decodeSingle(raw);
    await this.composer.scalar(value, value, true);
    return { value, style: quote === '"' ? "double" : "single" };
  }

  async #alias(): Promise<ParsedNode> {
    const match = /^\*([^\s,\[\]{}]+)/u.exec(this.source.slice(this.#position));
    if (!match) throw syntax(this.line, this.#position + 1);
    this.#position += match[0].length;
    return { value: await this.composer.alias(match[1]!) };
  }

  async #plain(keyMode: boolean): Promise<ParsedNode> {
    const start = this.#position;
    let depth = 0;
    while (this.#position < this.source.length) {
      const character = this.source[this.#position]!;
      if (character === "[" || character === "{") depth++;
      if (character === "]" || character === "}") {
        if (depth === 0) break;
        depth--;
      }
      if (depth === 0 && (character === "," || character === "]" || character === "}")) break;
      if (depth === 0 && character === ":" && (keyMode || /[\s,\]}]/u.test(this.source[this.#position + 1] ?? ""))) break;
      this.#position++;
    }
    const projectedBytes = projectPlainBytes(this.source, start, this.#position);
    this.composer.admitScalar(projectedBytes);
    const raw = this.source.slice(start, this.#position).trim().replace(/\r?\n[ \t]*/gu, " ");
    if (raw.length === 0) throw syntax(this.line, start + 1);
    const value = scalarFromPlain(raw);
    await this.composer.scalar(typeof value === "string" ? value : raw, value, true);
    return { value, style: "plain", raw };
  }

  #space(): void {
    while (/[ \t\r\n]/u.test(this.source[this.#position] ?? "")) this.#position++;
  }
}

class Composer {
  readonly #anchors = new Map<string, AnchorRecord>();
  readonly #futureAnchors: Set<string>;

  constructor(
    readonly work: YqOwnedWork,
    readonly ledger: YqLedger,
    futureAnchors: Iterable<string>,
  ) {
    this.#futureAnchors = new Set(futureAnchors);
  }

  async node(): Promise<void> {
    await this.work.charge(1);
    this.work.assertOpen();
    this.ledger.admitNode();
  }

  admitScalar(bytes: number): void {
    this.ledger.admitScalar(bytes);
  }

  async scalar(text: string, value: Json = text, admitted = false): Promise<void> {
    await this.node();
    const bytes = Buffer.byteLength(text);
    if (!admitted) this.ledger.admitScalar(bytes);
    let codePoints = 0;
    for (const unused of text) {
      void unused;
      codePoints++;
      if (codePoints === 256) {
        await this.work.charge(codePoints);
        this.work.assertOpen();
        codePoints = 0;
      }
    }
    if (codePoints > 0) await this.work.charge(codePoints);
    this.work.assertOpen();
    if (bytes > 0) await this.work.charge(Math.ceil(bytes / 1024));
    this.work.assertOpen();
    this.ledger.admitValueBytes(compactScalarBytes(value));
  }

  collection(): void {
    this.ledger.admitValueBytes(2);
  }

  member(size: number): void {
    if (size > yqCaps.maxCollectionSize) throw limit("LIMIT_MAX_COLLECTION_SIZE");
    if (size > 1) this.ledger.admitValueBytes(1);
  }

  mappingEntry(target: Record<string, Json>, key: ParsedNode, value: Json, implicit: boolean, memberAdmitted = false): void {
    if (typeof key.value !== "string") throw schema("SCHEMA_NONSTRING_KEY");
    if (implicit && countCodePoints(key.value) > 1024) throw syntax();
    if (key.style === "plain" && key.explicitTag === undefined && key.value === "<<") throw schema("SCHEMA_PLAIN_MERGE_KEY");
    if (Object.hasOwn(target, key.value)) throw schema("SCHEMA_DUPLICATE_KEY");
    if (!memberAdmitted) this.member(objectKeys(target).length + 1);
    this.ledger.admitValueBytes(1);
    put(target, key.value, value);
  }

  beginAnchor(name: string): AnchorRecord {
    this.ledger.admitAnchor();
    this.#futureAnchors.delete(name);
    const record: AnchorRecord = { name, pending: true };
    this.#anchors.set(name, record);
    return record;
  }

  completeAnchor(record: AnchorRecord, value: Json): void {
    record.pending = false;
    record.value = value;
  }

  async alias(name: string): Promise<Json> {
    const record = this.#anchors.get(name);
    if (!record) throw aliasFailure(this.#futureAnchors.has(name) ? "ALIAS_FORWARD" : "ALIAS_UNDEFINED");
    if (record.pending || record.value === undefined) throw aliasFailure("ALIAS_CURRENT_NODE");
    return copyAlias(record.value, this.ledger, this.work);
  }

  async applyTag(node: ParsedNode, tag?: string): Promise<ParsedNode> {
    if (tag === undefined) return node;
    const collection = Array.isArray(node.value) ? "seq" : node.value !== null && typeof node.value === "object" && !(node.value instanceof Decimal) ? "map" : "scalar";
    if (tag === "map" || tag === "seq") {
      if (collection !== tag) throw schema("SCHEMA_TAG_KIND_MISMATCH");
      return node;
    }
    if (collection !== "scalar") throw schema("SCHEMA_TAG_KIND_MISMATCH");
    const raw = node.raw ?? (typeof node.value === "string" ? node.value : node.value instanceof Decimal ? node.value.text : String(node.value));
    const value = scalarFromPlain(raw, tag);
    return { value, ...(node.style === undefined ? {} : { style: node.style }), explicitTag: tag, ...(node.raw === undefined ? {} : { raw: node.raw }) };
  }
}

class BlockParser {
  #index = 0;

  constructor(
    readonly lines: SourceLine[],
    readonly composer: Composer,
  ) {}

  async parse(): Promise<Json> {
    this.#skip();
    if (this.#index >= this.lines.length) {
      await this.composer.scalar("", null);
      return null;
    }
    const indent = indentation(this.lines[this.#index]!.text);
    const node = await this.#node(indent);
    this.#skip();
    if (this.#index < this.lines.length) throw syntax(this.lines[this.#index]!.number, 1);
    return node.value;
  }

  async #node(indent: number): Promise<ParsedNode> {
    this.#skip();
    const line = this.lines[this.#index];
    if (!line) {
      await this.composer.scalar("", null);
      return { value: null, style: "plain" };
    }
    const actual = indentation(line.text);
    if (actual !== indent) throw syntax(line.number, actual + 1);
    const content = stripComment(line.text.slice(indent));
    if (/^-(?:[ \t]|$)/u.test(content)) return this.#sequence(indent);
    if (content.startsWith("? ") || mappingColon(content) >= 0) return this.#mapping(indent);
    this.#index++;
    return this.#inlineOrBlock(content, indent, line.number);
  }

  async #sequence(indent: number): Promise<ParsedNode> {
    await this.composer.node();
    this.composer.collection();
    const result: Json[] = [];
    while (this.#index < this.lines.length) {
      this.#skip();
      const line = this.lines[this.#index];
      if (!line || indentation(line.text) !== indent) break;
      const content = stripComment(line.text.slice(indent));
      if (!/^-(?:[ \t]|$)/u.test(content)) break;
      this.composer.member(result.length + 1);
      this.#index++;
      const rest = content.slice(1).trimStart();
      let item: ParsedNode;
      if (rest.length === 0) {
        this.#skip();
        const next = this.lines[this.#index];
        item = next && indentation(next.text) > indent ? await this.#node(indentation(next.text)) : { value: null, style: "plain" };
        if (!next || indentation(next.text) <= indent) await this.composer.scalar("", null);
      } else if (mappingColon(rest) >= 0) {
        item = await this.#inlineMappingItem(rest, indent + 2, line.number);
      } else item = await this.#inlineOrBlock(rest, indent, line.number);
      result.push(item.value);
    }
    return { value: result };
  }

  async #inlineMappingItem(first: string, indent: number, lineNumber: number): Promise<ParsedNode> {
    await this.composer.node();
    this.composer.collection();
    const result = object();
    let members = 1;
    this.composer.member(members);
    await this.#mappingLine(result, first, indent, lineNumber, true);
    while (this.#index < this.lines.length) {
      this.#skip();
      const line = this.lines[this.#index];
      if (!line || indentation(line.text) !== indent) break;
      const content = stripComment(line.text.slice(indent));
      if (mappingColon(content) < 0) break;
      this.composer.member(++members);
      this.#index++;
      await this.#mappingLine(result, content, indent, line.number, true);
    }
    return { value: result };
  }

  async #mapping(indent: number): Promise<ParsedNode> {
    await this.composer.node();
    this.composer.collection();
    const result = object();
    let members = 0;
    while (this.#index < this.lines.length) {
      this.#skip();
      const line = this.lines[this.#index];
      if (!line || indentation(line.text) !== indent) break;
      const content = stripComment(line.text.slice(indent));
      if (content.startsWith("? ")) {
        this.composer.member(++members);
        this.#index++;
        const key = await this.#inlineOrBlock(content.slice(2).trimStart(), indent, line.number);
        this.#skip();
        const valueLine = this.lines[this.#index];
        if (!valueLine || indentation(valueLine.text) !== indent || !stripComment(valueLine.text.slice(indent)).startsWith(":")) throw syntax(line.number, 1);
        this.#index++;
        const valueText = stripComment(valueLine.text.slice(indent)).slice(1).trimStart();
        const value = valueText.length > 0 ? await this.#inlineOrBlock(valueText, indent, valueLine.number) : await this.#nestedOrNull(indent);
        this.composer.mappingEntry(result, key, value.value, false, true);
        continue;
      }
      const colon = mappingColon(content);
      if (colon < 0) break;
      this.composer.member(++members);
      this.#index++;
      await this.#mappingLine(result, content, indent, line.number, true);
    }
    return { value: result };
  }

  async #mappingLine(target: Record<string, Json>, content: string, indent: number, lineNumber: number, memberAdmitted: boolean): Promise<void> {
    const colon = mappingColon(content);
    if (colon < 0) throw syntax(lineNumber, 1);
    const keyText = content.slice(0, colon).trimEnd();
    const valueText = content.slice(colon + 1).trimStart();
    const key = await this.#inlineOrBlock(keyText, indent, lineNumber);
    const value = valueText.length > 0 ? await this.#inlineOrBlock(valueText, indent, lineNumber) : await this.#nestedOrNull(indent);
    this.composer.mappingEntry(target, key, value.value, true, memberAdmitted);
  }

  async #nestedOrNull(parentIndent: number): Promise<ParsedNode> {
    this.#skip();
    const next = this.lines[this.#index];
    if (next && indentation(next.text) > parentIndent) return this.#node(indentation(next.text));
    if (next && indentation(next.text) === parentIndent && /^-(?:[ \t]|$)/u.test(stripComment(next.text.slice(parentIndent)))) {
      return this.#node(parentIndent);
    }
    await this.composer.scalar("", null);
    return { value: null, style: "plain" };
  }

  async #inlineOrBlock(content: string, parentIndent: number, lineNumber: number): Promise<ParsedNode> {
    const property = /^(?:(!![^\s]+|!<[^>]+>|!)\s+)?(?:&([^\s]+)\s+)?([|>])([1-9]?[+-]?|[+-]?[1-9]?)$/u.exec(content);
    if (property) return this.#blockScalar(property, parentIndent, lineNumber);
    if (/^[|>]/u.test(content)) throw syntax(lineNumber, 1);
    let source = content;
    if (!this.#inlineBalanced(source)) {
      while (this.#index < this.lines.length && !this.#inlineBalanced(source)) {
        source += `\n${this.lines[this.#index++]!.text.trimStart()}`;
      }
      if (!this.#inlineBalanced(source)) throw syntax(lineNumber, 1);
    }
    return new FlowParser(source, this.composer, lineNumber).parse();
  }

  async #blockScalar(match: RegExpExecArray, parentIndent: number, lineNumber: number): Promise<ParsedNode> {
    const tag = match[1] === undefined ? undefined : normalizeTag(match[1]);
    const anchorName = match[2];
    const style = match[3] === "|" ? "literal" : "folded";
    const header = match[4] ?? "";
    const digitMatch = /[1-9]/u.exec(header);
    const chomping = header.includes("+") ? "+" : header.includes("-") ? "-" : "clip";
    let contentIndent = digitMatch ? parentIndent + Number(digitMatch[0]) : -1;
    if (contentIndent < 0) {
      for (let cursor = this.#index; cursor < this.lines.length; cursor++) {
        if (this.lines[cursor]!.text.trim().length > 0) {
          contentIndent = indentation(this.lines[cursor]!.text);
          break;
        }
      }
      if (contentIndent < 0) contentIndent = parentIndent + 1;
    }
    const values: BlockScalarPart[] = [];
    while (this.#index < this.lines.length) {
      const line = this.lines[this.#index]!;
      const actual = indentation(line.text);
      if (line.text.trim().length > 0 && actual < contentIndent) break;
      this.#index++;
      const empty = line.text.trim().length === 0;
      values.push({ lineText: line.text, contentIndent, empty, moreIndented: !empty && actual > contentIndent, hadBreak: line.hadBreak });
    }
    const projectedBytes = projectBlockScalarBytes(values, style, chomping);
    this.composer.admitScalar(projectedBytes);
    const value = buildBlockScalar(values, style, chomping);
    const record = anchorName === undefined ? undefined : this.composer.beginAnchor(anchorName);
    await this.composer.scalar(value, value, true);
    let node: ParsedNode = { value, style };
    node = await this.composer.applyTag(node, tag);
    if (record) this.composer.completeAnchor(record, node.value);
    void lineNumber;
    return node;
  }

  #quotesBalanced(source: string): boolean {
    let single = false;
    let double = false;
    let escaped = false;
    for (let index = 0; index < source.length; index++) {
      const character = source[index]!;
      if (double) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') double = false;
      } else if (single) {
        if (character === "'" && source[index + 1] === "'") index++;
        else if (character === "'") single = false;
      } else if (character === '"') double = true;
      else if (character === "'") single = true;
    }
    return !single && !double;
  }

  #inlineBalanced(source: string): boolean {
    if (!this.#quotesBalanced(source)) return false;
    let single = false;
    let double = false;
    let escaped = false;
    let depth = 0;
    for (let index = 0; index < source.length; index++) {
      const character = source[index]!;
      if (double) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') double = false;
      } else if (single) {
        if (character === "'" && source[index + 1] === "'") index++;
        else if (character === "'") single = false;
      } else if (character === '"') double = true;
      else if (character === "'") single = true;
      else if (character === "[" || character === "{") depth++;
      else if (character === "]" || character === "}") depth--;
      if (depth < 0) return true;
    }
    return depth === 0;
  }

  #skip(): void {
    while (this.#index < this.lines.length) {
      const line = this.lines[this.#index]!;
      const indent = indentation(line.text);
      const content = line.text.slice(indent);
      if (content.trim().length > 0 && !content.startsWith("#")) return;
      this.#index++;
    }
  }
}

function rawLines(text: string, lineOffset = 0): SourceLine[] {
  const normalized = text.replace(/\r\n|\r/gu, "\n");
  const finalBreak = normalized.endsWith("\n");
  const pieces = normalized.split("\n");
  if (pieces[pieces.length - 1] === "") pieces.pop();
  return pieces.map((line, index) => {
    const hadBreak = index < pieces.length - 1 || finalBreak;
    return { text: line, number: lineOffset + index + 1, rawBytes: Buffer.byteLength(line) + (hadBreak ? 1 : 0), hadBreak };
  });
}

function* documents(text: string, lineOffset = 0): Generator<RawDocument> {
  const lines = rawLines(text, lineOffset);
  let current: SourceLine[] = [];
  let explicit = false;
  let ended = false;
  let directives = 0;
  let sawContent = false;
  const take = (force: boolean): RawDocument | undefined => {
    const document = force || sawContent || explicit
      ? { lines: current, explicit, rawBytes: current.reduce((sum, line) => sum + line.rawBytes, 0) }
      : undefined;
    current = [];
    explicit = false;
    sawContent = false;
    directives = 0;
    return document;
  };
  for (const original of lines) {
    let line = original;
    if (line.number === 1 && line.text.startsWith("\ufeff")) line = { ...line, text: line.text.slice(1) };
    if (ended && line.text.startsWith("\ufeff")) line = { ...line, text: line.text.slice(1) };
    const trimmed = stripComment(line.text).trim();
    if (line.text.startsWith("%")) {
      if (sawContent || explicit || ended) throw structure(line.number, 1);
      if (trimmed !== "%YAML 1.2" || directives > 0) throw schema("SCHEMA_UNSUPPORTED_DIRECTIVE", line.number, 1);
      directives++;
      continue;
    }
    if (/^---(?:[ \t]+#.*)?$/u.test(line.text)) {
      if (sawContent || explicit) {
        const document = take(false);
        if (document) yield document;
      }
      explicit = true;
      ended = false;
      continue;
    }
    if (/^\.\.\.(?:[ \t]+#.*)?$/u.test(line.text)) {
      if (!sawContent && !explicit) {
        ended = true;
        continue;
      }
      const document = take(true);
      if (document) yield document;
      ended = true;
      continue;
    }
    if (ended) {
      if (trimmed === "") continue;
      ended = false;
    }
    if (directives > 0 && !explicit && trimmed !== "") throw structure(line.number, 1);
    current.push(line);
    if (trimmed !== "") sawContent = true;
  }
  const document = take(false);
  if (document) yield document;
}

function futureAnchorNames(lines: readonly SourceLine[]): string[] {
  const names: string[] = [];
  for (const line of lines) {
    const source = stripComment(line.text);
    const matcher = /(?:^|[\s\[,{}])&([^\s\[\],{}]+)/gu;
    for (const match of source.matchAll(matcher)) names.push(match[1]!);
  }
  return names;
}

export async function* parseYamlDocuments(text: string, work: YqOwnedWork, ledger: YqLedger, admittedRawBytes?: number, lineOffset = 0): AsyncGenerator<Json> {
  if (!wellFormed(text)) throw new YqError("input", "INPUT_INVALID_UTF8", 5);
  let admitted = false;
  for (const document of documents(text, lineOffset)) {
    ledger.beginDocument(admittedRawBytes !== undefined && !admitted ? admittedRawBytes : document.rawBytes);
    admitted = true;
    let singleQuoted = false;
    let doubleQuoted = false;
    let escaped = false;
    for (const line of document.lines) {
      let codePoints = 0;
      for (let index = 0; index < line.text.length; index++) {
        const character = line.text[index]!;
        const point = character.codePointAt(0)!;
        if (doubleQuoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') doubleQuoted = false;
          if (!(point === 0x09 || point >= 0x20)) throw syntax(line.number, index + 1);
        } else if (singleQuoted) {
          if (character === "'" && line.text[index + 1] === "'") index++;
          else if (character === "'") singleQuoted = false;
          if (!(point === 0x09 || point >= 0x20)) throw syntax(line.number, index + 1);
        } else {
          if (character === '"') doubleQuoted = true;
          else if (character === "'") singleQuoted = true;
          const printable = point === 0x09 || point >= 0x20 && point <= 0x7e || point === 0x85 || point >= 0xa0 && point <= 0xd7ff || point >= 0xe000 && point <= 0xfffd || point >= 0x10000 && point <= 0x10ffff;
          if (!printable) throw syntax(line.number, index + 1);
          if (point === 0xfeff) throw structure(line.number, index + 1);
        }
        codePoints++;
        if (point > 0xffff) index++;
        if (codePoints === 256) {
          await work.charge(codePoints);
          work.assertOpen();
          codePoints = 0;
        }
      }
      if (codePoints > 0) await work.charge(codePoints);
      work.assertOpen();
    }
    const composer = new Composer(work, ledger, futureAnchorNames(document.lines));
    const value = await new BlockParser(document.lines, composer).parse();
    work.assertOpen();
    yield value;
  }
}

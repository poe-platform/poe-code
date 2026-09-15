import { DocumentBudget } from "./budget.js";

export class DocxUsageError extends Error {
  readonly code = "usage";
  readonly exitCode = 2;
}

export function docxByteLength(bytes: Uint8Array): number {
  if (!ArrayBuffer.isView(bytes) || !(bytes instanceof Uint8Array)) throw new DocxUsageError("Expected a byte source.");
  try {
    return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!.call(bytes) as number;
  } catch { throw new DocxUsageError("Expected a byte source."); }
}

export function copyDocxBytes(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(docxByteLength(bytes));
  Uint8Array.prototype.set.call(result, bytes);
  return result;
}

export function decodeDocxText(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new DocxUsageError("Expected valid UTF-8 text."); }
}

function validText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function integralTokenUnchanged(token: string, value: number): boolean {
  const lowerExponent = token.indexOf("e"), upperExponent = token.indexOf("E");
  const exponentAt = lowerExponent < 0 ? upperExponent : lowerExponent;
  const end = exponentAt < 0 ? token.length : exponentAt;
  const dot = token.indexOf(".");
  const exponent = exponentAt < 0 ? 0 : Number(token.slice(exponentAt + 1));
  const scale = exponent - (dot < 0 ? 0 : end - dot - 1);
  let digits = 0, leading = 0, trailing = 0, nonzero = false;
  for (let index = token[0] === "-" ? 1 : 0; index < end; index++) {
    const digit = token[index]!;
    if (digit === ".") continue;
    digits++;
    if (digit === "0") { if (!nonzero) leading++; trailing++; }
    else { nonzero = true; trailing = 0; }
  }
  if (!nonzero) return value === 0;
  // A nonintegral decimal keeps ordinary finite floating-point semantics.
  if (scale < 0 && -scale > trailing) return true;
  const length = digits - leading + scale;
  // A finite binary64 integer has at most 309 decimal digits. Never expand an exponent beyond this bound.
  if (!Number.isInteger(value) || length < 1 || length > 309) return false;
  const retainedDigits = digits + Math.min(scale, 0);
  let canonical = "", position = 0;
  for (let index = token[0] === "-" ? 1 : 0; index < end; index++) {
    const digit = token[index]!;
    if (digit === ".") continue;
    if (position >= leading && position < retainedDigits) canonical += digit;
    position++;
  }
  if (scale > 0) canonical += "0".repeat(scale);
  return canonical === BigInt(Math.abs(value)).toString();
}

export function parseDocxJson(input: string | Uint8Array, budget = new DocumentBudget()): unknown {
  budget.check("xmlPartBytes", typeof input === "string" ? new TextEncoder().encode(input).length : docxByteLength(input));
  let source = typeof input === "string" ? input : decodeDocxText(input);
  if (!validText(source)) throw new DocxUsageError("JSON contains invalid Unicode.");
  if (source.startsWith("\uFEFF")) source = source.slice(1);
  let cursor = 0;
  const fail = (): never => { throw new DocxUsageError(`Invalid JSON at offset ${cursor}.`); };
  const whitespace = () => { while (cursor < source.length && " \t\r\n".includes(source[cursor]!)) cursor++; };
  const string = (): string => {
    const start = cursor++;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === "\\") { cursor++; continue; }
      if (char !== '"') continue;
      let result: unknown;
      try { result = JSON.parse(source.slice(start, cursor)); } catch { return fail(); }
      if (typeof result !== "string" || !validText(result)) return fail();
      budget.charge("retainedBytes", new TextEncoder().encode(result).length);
      return result;
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    budget.check("xmlDepth", depth);
    budget.charge("xmlNodes", 1);
    whitespace();
    const char = source[cursor];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      cursor++;
      const array = char === "[";
      const close = array ? "]" : "}";
      const result: Record<string, unknown> = {};
      const items: unknown[] = [];
      const keys = new Set<string>();
      whitespace();
      if (source[cursor] === close) { cursor++; return array ? items : result; }
      while (cursor < source.length) {
        if (array) items.push(value(depth + 1));
        else {
          whitespace();
          if (source[cursor] !== '"') return fail();
          const key = string();
          if (forbidden.has(key) || keys.has(key)) return fail();
          keys.add(key);
          whitespace();
          if (source[cursor++] !== ":") return fail();
          result[key] = value(depth + 1);
        }
        whitespace();
        const next = source[cursor++];
        if (next === close) return array ? items : result;
        if (next !== ",") return fail();
      }
      return fail();
    }
    const start = cursor;
    while (cursor < source.length && !" \t\r\n,]}".includes(source[cursor]!)) cursor++;
    if (cursor === start) return fail();
    // Reserve token slices, bounded integer conversion and at most 309-digit expansion before allocation.
    budget.charge("work", (cursor - start) * 2 + 1024);
    budget.charge("retainedBytes", (cursor - start) * 2 + 2048);
    const token = source.slice(start, cursor);
    let result: unknown;
    try { result = JSON.parse(token); } catch { return fail(); }
    if (result === null || typeof result === "boolean" || finite(result) && integralTokenUnchanged(token, result)) return result;
    return fail();
  };
  const result = value(1);
  whitespace();
  if (cursor !== source.length) return fail();
  return result;
}

type RecordValue = Record<string, unknown>;
function array(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) return false;
  }
  return true;
}
function record(value: unknown, allowed: string[], required: string[] = []): value is RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).every(key => typeof key === "string" && allowed.includes(key) &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")) &&
    required.every(key => Object.hasOwn(value, key) && (value as RecordValue)[key] !== undefined);
}
const text = (value: unknown): value is string => typeof value === "string" && validText(value);
const identifier = (value: unknown): value is string => text(value) && value.length > 0 && !value.includes("\0");
function optional(value: RecordValue, key: string, check: (value: unknown) => boolean): boolean {
  return value[key] === undefined || check(value[key]);
}
function length(value: unknown): boolean {
  return record(value, ["value", "unit"], ["value", "unit"]) && finite(value.value) && Math.abs(value.value) <= Number.MAX_SAFE_INTEGER &&
    ["emu", "in", "cm", "mm", "pt", "twip"].includes(value.unit as string);
}

const tableKeys = ["width", "style", "columnWidths", "autofit", "repeatHeader", "headerRows", "allowRowSplit", "rowHeight", "heightRule", "borders", "shading", "cellMargin", "rowOptions"];
const color = (value: unknown) => typeof value === "string" && value.length === 6 && [...value].every(c => "0123456789abcdefABCDEF".includes(c));
const heightRule = (value: unknown) => record(value, ["enum", "name"], ["enum", "name"]) && value.enum === "WD_ROW_HEIGHT_RULE" && ["AUTO", "AT_LEAST", "EXACTLY"].includes(value.name as string);
const shading = (value: unknown) => record(value, ["fill", "color", "pattern"], ["fill", "pattern"]) && color(value.fill) && optional(value, "color", color) && ["clear", "solid", "pct5", "pct10", "pct20", "pct25", "pct50", "pct75"].includes(value.pattern as string);
const borders = (value: unknown) => record(value, ["top", "left", "bottom", "right", "insideH", "insideV"]) && Object.values(value).every(v => v === undefined || record(v, ["style", "width", "color", "space"], ["style", "width", "color"]) && ["none", "single", "double", "dotted", "dashed"].includes(v.style as string) && length(v.width) && color(v.color) && optional(v, "space", length));
const rowOptions = (value: unknown) => record(value, ["repeatHeader", "allowRowSplit", "height", "heightRule"]) && optional(value, "repeatHeader", v => typeof v === "boolean") && optional(value, "allowRowSplit", v => typeof v === "boolean") && optional(value, "height", length) && optional(value, "heightRule", heightRule);
function tableFormat(value: RecordValue): boolean {
  return optional(value, "width", length) && optional(value, "style", identifier) &&
    optional(value, "columnWidths", v => array(v) && v.every(length)) &&
    ["autofit", "repeatHeader", "allowRowSplit"].every(key => optional(value, key, v => typeof v === "boolean")) &&
    optional(value, "headerRows", v => Number.isSafeInteger(v) && Number(v) >= 0) &&
    optional(value, "rowHeight", length) && optional(value, "heightRule", heightRule) && optional(value, "borders", borders) &&
    optional(value, "shading", shading) && optional(value, "cellMargin", length) && optional(value, "rowOptions", v => array(v) && v.every(rowOptions));
}

export function validateOriginalDocumentContent(value: unknown): boolean {
  const ancestors = new Set<object>();
  function blocks(value: unknown): boolean {
    if (!array(value) || ancestors.has(value)) return false;
    ancestors.add(value);
    const result = value.every(block);
    ancestors.delete(value);
    return result;
  }
  function block(value: unknown): boolean {
    if (!record(value, ["kind", "text", "level", "runs", "rows", ...tableKeys], ["kind"]) || ancestors.has(value)) return false;
    ancestors.add(value);
    let result = false;
    if (value.kind === "paragraph") result = record(value, ["kind", "text", "style", "level", "runs"], ["kind"]) &&
      !(value.text !== undefined && value.runs !== undefined) && !(value.style !== undefined && value.level !== undefined) &&
      optional(value, "text", text) && optional(value, "style", identifier) &&
      optional(value, "level", item => Number.isSafeInteger(item) && Number(item) >= 0 && Number(item) <= 9) &&
      optional(value, "runs", item => array(item) && item.every(run));
    if (value.kind === "table") {
      const rows = value.rows;
      result = record(value, ["kind", "rows", ...tableKeys], ["kind", "rows"]) && tableFormat(value) && array(rows) && rows.length > 0 &&
        array(rows[0]) && rows[0].length > 0 && rows.every(row => array(row) && row.length === (rows[0] as unknown[]).length &&
          row.every(cell => record(cell, ["blocks", "borders", "shading", "margins"], ["blocks"]) && optional(cell, "borders", borders) && optional(cell, "shading", shading) && optional(cell, "margins", v => record(v, ["top", "left", "bottom", "right"]) && Object.values(v).every(n => n === undefined || length(n))) && blocks(cell.blocks)));
    }
    ancestors.delete(value);
    return result;
  }
  function run(value: unknown): boolean {
    const nullableBoolean = (item: unknown) => item === null || typeof item === "boolean";
    return record(value, ["text", "bold", "italic", "underline", "style"], ["text"]) && text(value.text) &&
      optional(value, "bold", nullableBoolean) && optional(value, "italic", nullableBoolean) && optional(value, "style", identifier) &&
      optional(value, "underline", item => nullableBoolean(item) || (record(item, ["enum", "name"], ["enum", "name"]) &&
        item.enum === "WD_UNDERLINE" && ["NONE", "SINGLE", "WORDS", "DOUBLE", "DOTTED", "THICK", "DASH", "DOT_DASH", "DOT_DOT_DASH", "WAVY", "DOTTED_HEAVY", "DASH_HEAVY", "DOT_DASH_HEAVY", "DOT_DOT_DASH_HEAVY", "WAVY_HEAVY", "DASH_LONG", "WAVY_DOUBLE", "DASH_LONG_HEAVY"].includes(item.name as string)));
  }
  const page = (item: unknown) => record(item, ["width", "height", "orientation", "margins"]) &&
    optional(item, "width", length) && optional(item, "height", length) && optional(item, "orientation", v => v === "portrait" || v === "landscape") &&
    optional(item, "margins", v => record(v, ["top", "right", "bottom", "left", "header", "footer", "gutter"]) && Object.values(v).every(n => n === undefined || length(n)));
  const style = (item: unknown) => record(item, ["name", "type", "font", "size", "bold", "italic"], ["name", "type"]) && identifier(item.name) &&
    ["paragraph", "character", "table"].includes(item.type as string) && optional(item, "font", identifier) && optional(item, "size", length) &&
    optional(item, "bold", v => typeof v === "boolean") && optional(item, "italic", v => typeof v === "boolean");
  const theme = (item: unknown) => record(item, ["name", "majorFont", "minorFont", "colors"], ["name", "majorFont", "minorFont"]) &&
    identifier(item.name) && identifier(item.majorFont) && identifier(item.minorFont) && optional(item, "colors", v =>
      record(v, ["dark1", "light1", "dark2", "light2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hyperlink", "followedHyperlink"]) &&
      Object.values(v).every(color => color === undefined || typeof color === "string" && color.length === 6 && [...color].every(c => "0123456789abcdefABCDEF".includes(c))));
  return record(value, ["version", "blocks", "page", "styles", "theme"], ["version", "blocks"]) && value.version === 1 && blocks(value.blocks) &&
    optional(value, "page", page) && optional(value, "styles", v => array(v) && v.every(style)) && optional(value, "theme", theme);
}

export function validateTemplateData(value: unknown): boolean {
  const entry = (value: unknown): boolean => {
    if (!record(value, ["values"], ["values"]) || !array(value.values)) return false;
    const seen = new Set<string>();
    return value.values.every(item => {
      if (!record(item, ["binding", "value"], ["binding", "value"]) || !identifier(item.binding) || seen.has(item.binding)) return false;
      seen.add(item.binding);
      return text(item.value) || typeof item.value === "boolean" || finite(item.value);
    });
  };
  return array(value) ? value.every(entry) : entry(value);
}

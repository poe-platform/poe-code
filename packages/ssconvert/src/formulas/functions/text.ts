import { isUnicodeAlpha } from "../../workbook/unicode-sheet-name.js";
import { foldSheetName } from "../../workbook/case-fold.js";
import { isUnicodePrintable, simpleUnicodeCase } from "./unicode.js";
import { SsconvertError } from "../../contracts.js";
import { byteTextLength, encodeByteText, sliceByteText } from "../../encoding/byte-text.js";
import type { CellValue } from "../../workbook.js";
import { blank, error, numericResult, numericText, rendered } from "../values.js";
import { admitMatrix, asBoolean, bool, boundedText, collect, numberArg, scalarArg, str, textArg, unsupported, wildcard } from "./common.js";
import type { FunctionHost, FunctionImplementation, SpecialForm, Value } from "./types.js";
import { fixedNumber, formatText } from "../../formatting/number-format.js";
import { canonicalTextPattern, formattingLocale } from "../../formatting/locale.js";

const cp1252 = [0x20ac, 0, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0, 0x17d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0, 0x17e, 0x178];
const katakana = "。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜";
const fullSpecial: Readonly<Record<string, string>> = { '"': "”", "'": "’", "\\": "￥", "`": "‘" };
const halfSpecial: Readonly<Record<string, string>> = { "―": "ｰ", "‘": "`", "’": "'", "”": '"', "￥": "\\" };
const byteLength = (s: string) => new TextEncoder().encode(s).length;
function byteOffsets(s: string, host: FunctionHost): number[] {
  const offsets = [0]; let size = 0;
  for (const c of s) { host.tick(); size += byteLength(c); offsets.push(size); }
  return offsets;
}
function sliceText(name: string, args: readonly (Value | undefined)[], host: FunctionHost): CellValue {
  const source = textArg(args, 0, host), bytes = name.endsWith("B");
  const middle = name.startsWith("MID"), right = name.startsWith("RIGHT");
  const count = numberArg(args, middle ? 2 : 1, host, 1), start = numberArg(args, 1, host, 1);
  if (count < 0 || middle && start < 1) return error("#VALUE!");
  if (!bytes) {
    const result = sliceByteText(encodeByteText(source, host.tick), middle ? "mid" : right ? "right" : "left", start, count, host.tick);
    return result === undefined ? error("#VALUE!") : str(new TextDecoder("UTF-8", { fatal: true }).decode(result));
  }
  const chars = Array.from(source), offsets = byteOffsets(source, host), length = offsets.at(-1)!;
  const from = middle ? Math.trunc(start) - 1 : right ? Math.max(0, length - Math.trunc(count)) : 0;
  if (middle && (from >= length || !offsets.includes(from))) return error("#VALUE!");
  const first = right ? offsets.findIndex(offset => offset >= from) : offsets.indexOf(from);
  const end = right ? length : Math.min(length, from + Math.trunc(count));
  let last = offsets.length - 1;
  while (offsets[last]! > end) { host.tick(); last--; }
  return str(chars.slice(first, last).join(""));
}
function search(name: string, args: readonly (Value | undefined)[], host: FunctionHost): CellValue {
  const needle = textArg(args, 0, host), source = textArg(args, 1, host), chars = Array.from(source);
  const start = numberArg(args, 2, host, 1), bytes = name.endsWith("B"), offsets = byteOffsets(source, host);
  const length = bytes ? offsets.at(-1)! : chars.length;
  const invalidStart = name.startsWith("FIND") ? start >= length + 1
    : bytes ? start > length : start >= 2147483647 || Math.trunc(start) > length + 1;
  if (start < 1 || invalidStart) return error("#VALUE!");
  const initial = bytes ? offsets.findIndex(offset => offset >= Math.trunc(start) - 1) : Math.trunc(start) - 1;
  for (let index = initial; index <= chars.length; index++) {
    host.tick(); const tail = chars.slice(index).join("");
    if (name.startsWith("SEARCH") ? wildcard(needle, tail, host, false) : tail.startsWith(needle)) return numericResult((bytes ? offsets[index]! : index) + 1);
  }
  return error("#VALUE!");
}
function width(name: string, source: string, host: FunctionHost): CellValue {
  const chars = Array.from(source); let result = "";
  for (let i = 0; i < chars.length; i++) {
    host.tick(); const c = chars[i]!, point = c.codePointAt(0)!;
    if (name === "JIS") {
      let mapped = fullSpecial[c] ?? (point >= 0xff61 && point <= 0xff9f ? katakana[point - 0xff61]! : point >= 33 && point <= 126 ? String.fromCodePoint(point + 0xfee0) : c);
      const next = chars[i + 1];
      if ((point >= 0xff76 && point <= 0xff84 || point >= 0xff8a && point <= 0xff8e) && next === "ﾞ") mapped = (mapped + "\u3099").normalize("NFC");
      if (point >= 0xff8a && point <= 0xff8e && next === "ﾟ") mapped = (mapped + "\u309a").normalize("NFC");
      // The released JIS loop retains the following spacing mark.
      result += mapped;
    } else {
      const direct = katakana.indexOf(c);
      if (halfSpecial[c]) result += halfSpecial[c];
      else if (direct >= 0) result += String.fromCodePoint(0xff61 + direct);
      else if (point >= 0xff01 && point <= 0xff5e) result += String.fromCodePoint(point - 0xfee0);
      else {
        const parts = Array.from(c.normalize("NFD")), base = katakana.indexOf(parts[0]!);
        result += base >= 0 && parts.length === 2 && ["\u3099", "\u309a"].includes(parts[1]!)
          ? String.fromCodePoint(0xff61 + base) + (parts[1] === "\u3099" ? "ﾞ" : "ﾟ") : c;
      }
    }
  }
  return boundedText(result, host);
}
// Released number-match.c recognizes numeric dates, clock and elapsed times.
function temporalNumber(source: string, host: Pick<FunctionHost, "context" | "book" | "tick">, dateAllowed = true): number | undefined {
  const digitString = (text: string) => !!text && Array.from(text).every(c => { host.tick(); return c >= "0" && c <= "9"; });
  let text = source.trim(), sign = 1;
  // Each date separator is independent in re_yyyymmdd3/re_mmddyyyy. Scan
  // the numeric prefix so a trailing clock uses format_match_time rules.
  const parts: string[] = []; let position = 0;
  for (let index = 0; index < 3; index++) {
    const start = position;
    while (position < text.length && text[position]! >= "0" && text[position]! <= "9") { host.tick(); position++; }
    parts.push(text.slice(start, position));
    if (index < 2 && "-/.".includes(text[position] ?? "\0")) position++;
    else if (index < 2) break;
  }
  if (dateAllowed && parts.length === 3 && parts.every(digitString)) {
    const yearFirst = parts[0]!.length === 4;
    const yearText = parts[yearFirst ? 0 : 2]!;
    let year = Number(yearText);
    const monthText = parts[yearFirst ? 1 : 0]!, dayText = parts[yearFirst ? 2 : 1]!;
    const month = Number(monthText), day = Number(dayText);
    if (yearFirst && year < 1582) return undefined;
    if (year <= 29) year += 2000;
    else if (year <= 99) year += 1900;
    if (year < 1582 || year > 9999 || yearText.length > 4 || monthText.length > 2 || dayText.length > 2) return undefined;
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) return undefined;
    const use1904 = host.book.dateSystem === "1904";
    let serial = (date.getTime() - Date.UTC(use1904 ? 1904 : 1899, use1904 ? 0 : 11, use1904 ? 1 : 31)) / 86400000;
    if (!use1904 && serial >= 60) serial++;
    const rest = text.slice(position).trim();
    if (rest) {
      // A date suffix is a time, never another date or a plain number.
      const time = temporalNumber(rest, host, false); if (time === undefined) return undefined;
      serial += time;
    }
    return serial;
  }
  const meridiem = text.toLowerCase().endsWith("am") ? "am" : text.toLowerCase().endsWith("pm") ? "pm" : undefined;
  if (!dateAllowed && ["-", "+", "−"].some(prefix => text.startsWith(prefix))) return undefined;
  if (meridiem) text = text.slice(0, -2).trim();
  else if (text.startsWith("-") || text.startsWith("+") || text.startsWith("−")) { sign = text.startsWith("+") ? 1 : -1; text = text.slice(1); }
  const timeParts = text.split(":");
  const fractional = timeParts.at(-1)!.includes(".");
  if (meridiem && fractional && timeParts.length < 3) return undefined;
  const clockDigits = text.split(".")[0]!;
  const compact = !dateAllowed && !meridiem && timeParts.length === 1 && [4, 6].includes(clockDigits.length) && digitString(clockDigits);
  if (compact) timeParts.splice(0, 1, text.slice(0, 2), ...(clockDigits.length === 6 ? [text.slice(2, 4), text.slice(4)] : [text.slice(2)]));
  if (timeParts.length > 3 || timeParts.length < 2 && !meridiem && !fractional) return undefined;
  if (!timeParts.every((part, index) => {
    if (index !== timeParts.length - 1 || !fractional) return digitString(part);
    const digits = part.split(".");
    return digits.length === 2 && digitString(digits[0]!) && (digits[1] === "" || digitString(digits[1]!));
  })) return undefined;
  const values = timeParts.map(Number);
  let hour = 0, minute = 0, second = 0;
  if (timeParts.length === 3) [hour, minute, second] = values as [number, number, number];
  else if (timeParts.length === 1 && fractional && !meridiem) second = values[0]!;
  else if (fractional && !meridiem) [minute, second] = values as [number, number];
  else { hour = values[0]!; minute = values[1] ?? 0; }
  if (meridiem) { if (hour < 1 || hour > 12) return undefined; hour = hour % 12 + (meridiem === "pm" ? 12 : 0); }
  if (minute < 0 || minute >= 60 && !(fractional && timeParts.length === 2) || second < 0 || second >= 60 || !Number.isFinite(hour)) return undefined;
  if (!dateAllowed && (hour >= 24 || minute >= 60)) return undefined;
  return sign * (hour * 3600 + minute * 60 + second) / 86400;
}
export function matchNumber(source: string, host: Pick<FunctionHost, "context" | "book" | "tick">, separator?: string): number | boolean | undefined {
  if (!["C", "C.UTF-8", "C.utf8", "en_US", "en_US.UTF-8", "de_DE", "de_DE.UTF-8", "de_DE.utf8"].includes(host.context.environment.locale)) unsupported("uncaptured number locale");
  const locale = formattingLocale(host.context.environment.locale);
  separator ??= locale.decimal;
  // format_match_simple recognizes booleans without trimming whitespace.
  const boolean = asBoolean(str(source));
  if (boolean !== undefined) return boolean;
  if (source.toUpperCase() === locale.trueText) return true;
  if (source.toUpperCase() === locale.falseText) return false;
  let text = source.trim(), sign = 1;
  if (text.startsWith("(") && text.endsWith(")")) { sign = -1; text = text.slice(1, -1).trim(); }
  if (text.startsWith("$")) text = text.slice(1).trim();
  const grouping = separator === "." ? "," : ".";
  const parts = text.split(separator);
  if (parts.length > 2) return locale.decimal === "." ? temporalNumber(source, host) : undefined;
  const integral = parts[0]!.split(grouping);
  if (integral.length > 1 && (integral[0]!.length > 4 || integral.slice(1).some(part => part.length !== 3))) return undefined;
  text = integral.join("") + (parts.length === 2 ? "." + parts[1] : "");
  const n = numericText(text);
  if (n !== undefined) return n * sign;
  return locale.decimal === "." ? temporalNumber(source, host) : undefined;
}
interface DelimiterMatch { readonly start: number; readonly end: number; readonly row: boolean }
function delimiterMatches(source: string, columns: Value, rows: Value | undefined, insensitive: boolean, host: FunctionHost): DelimiterMatch[] {
  const candidates: DelimiterMatch[] = [];
  let haystack = "";
  for (const c of source) { host.tick(); haystack += insensitive ? foldSheetName(c) : c; }
  const offsets = new Map<number, number>(); let characterOffset = 0, byteOffset = 0;
  offsets.set(0, 0);
  for (const c of haystack) { host.tick(); characterOffset += c.length; byteOffset += byteLength(c); offsets.set(characterOffset, byteOffset); }
  for (const [value, row] of [[columns, false], [rows, true]] as const) {
    if (!value) continue;
    for (const cell of collect(value, host).reverse()) {
      const text = rendered(cell); if (!text) continue;
      let needle = "";
      for (const c of text) { host.tick(); needle += insensitive ? foldSheetName(c) : c; }
      let from = 0;
      while (from <= haystack.length) {
        host.tick(); const start = haystack.indexOf(needle, from); if (start < 0) break;
        if (candidates.length >= host.context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert delimiter limit exceeded");
        const byteStart = offsets.get(start)!;
        candidates.push({ start: byteStart, end: byteStart + byteLength(text), row }); from = start + needle.length;
      }
    }
  }
  candidates.sort((a, b) => { host.tick(); return a.start - b.start; });
  const matches: DelimiterMatch[] = []; let last = 0;
  for (const match of candidates) { host.tick(); if (match.start >= last) { matches.push(match); last = match.end; } }
  return matches;
}

function delimiterSlice(source: string, start: number, end: number | undefined, host: FunctionHost): string {
  let bytes = 0, offset = 0, first: number | undefined, last: number | undefined;
  for (const c of source) {
    host.tick();
    if (bytes === start) first = offset;
    if (bytes === end) last = offset;
    bytes += byteLength(c); offset += c.length;
  }
  if (bytes === start) first = offset;
  if (end === undefined || end >= bytes) last = offset;
  // Upstream can slice within a UTF-8 character after folding changes byte widths.
  // The workbook string model cannot preserve invalid UTF-8 bytes.
  if (first === undefined || last === undefined) unsupported("delimiter UTF-8 boundary");
  return source.slice(first, last);
}

export const textFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...Object.fromEntries(["LEFT", "LEFTB", "MID", "MIDB", "RIGHT", "RIGHTB"].map(name => [name, ((args, host) => sliceText(name, args, host)) satisfies FunctionImplementation])),
  ...Object.fromEntries(["FIND", "FINDB", "SEARCH", "SEARCHB"].map(name => [name, ((args, host) => search(name, args, host)) satisfies FunctionImplementation])),
  ...Object.fromEntries(["ASC", "JIS"].map(name => [name, ((args, host) => width(name, textArg(args, 0, host), host)) satisfies FunctionImplementation])),
  CHAR: (args, host) => {
    const n = numberArg(args, 0, host), point = Math.trunc(n), mapped = point >= 128 && point < 160 ? cp1252[point - 128] : point;
    return n >= 1 && n < 256 && mapped ? str(String.fromCodePoint(mapped)) : error("#VALUE!");
  },
  UNICHAR: (args, host) => { const n = numberArg(args, 0, host), point = Math.trunc(n); return n >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) && !(point >= 0xfdd0 && point <= 0xfdef) && (point & 0xffff) < 0xfffe ? str(point === 0 ? "" : String.fromCodePoint(point)) : error("#VALUE!"); },
  CODE: (args, host) => {
    const point = textArg(args, 0, host).codePointAt(0);
    if (point === undefined) return error("#VALUE!");
    const mapped = cp1252.indexOf(point);
    return point < 128 || point >= 160 && point < 256 ? numericResult(point) : mapped >= 0 ? numericResult(mapped + 128) : error("#VALUE!");
  },
  UNICODE: (args, host) => { const point = textArg(args, 0, host).codePointAt(0); return point === undefined ? error("#VALUE!") : numericResult(point); },
  LEN: (args, host) => numericResult(byteTextLength(encodeByteText(textArg(args, 0, host), host.tick), host.tick)),
  LENB: (args, host) => numericResult(byteLength(textArg(args, 0, host))),
  LOWER: (args, host) => boundedText(textArg(args, 0, host).toLowerCase(), host),
  UPPER: (args, host) => boundedText(textArg(args, 0, host).toUpperCase(), host),
  EXACT: (args, host) => bool(textArg(args, 0, host).normalize("NFD") === textArg(args, 1, host).normalize("NFD")),
  ENCODEURL: (args, host) => {
    let result = "";
    for (const byte of new TextEncoder().encode(textArg(args, 0, host))) {
      host.tick(); const c = String.fromCharCode(byte);
      result += byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 || byte >= 48 && byte <= 57 || "-._~".includes(c) ? c : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
    return boundedText(result, host);
  },
  CLEAN: (args, host) => {
    let result = "";
    for (const c of textArg(args, 0, host)) { host.tick(); const point = c.codePointAt(0)!; if (isUnicodePrintable(point)) result += c; }
    return str(result);
  },
  PROPER: (args, host) => {
    let result = "", inword = false;
    for (const c of textArg(args, 0, host)) {
      host.tick(); const point = c.codePointAt(0)!, letter = isUnicodeAlpha(point);
      result += letter ? simpleUnicodeCase(point, !inword) : c; inword = letter;
    }
    return boundedText(result, host);
  },
  TRIM: (args, host) => {
    let result = "", space = false;
    for (const c of textArg(args, 0, host)) { host.tick(); if (c === " ") { space = !!result; } else { if (space) result += " "; result += c; space = false; } }
    return str(result);
  },
  REPT: (args, host) => {
    const source = textArg(args, 0, host), count = numberArg(args, 1, host), length = byteLength(source);
    if (count < 0 || length && count >= 2147483647 / length) return error("#VALUE!");
    if (!length || count < 1) return str("");
    if (length * Math.trunc(count) > host.context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
    return str(source.repeat(Math.trunc(count)));
  },
  ...Object.fromEntries(["REPLACE", "REPLACEB"].map(name => [name, ((args, host) => {
    const source = textArg(args, 0, host), start = numberArg(args, 1, host), count = numberArg(args, 2, host), replacement = textArg(args, 3, host), chars = Array.from(source);
    if (start < 1 || count < 0) return error("#VALUE!");
    if (name === "REPLACE") { const from = Math.min(chars.length, Math.trunc(start - 1)); return boundedText(chars.slice(0, from).join("") + replacement + chars.slice(from + Math.trunc(count)).join(""), host); }
    const offsets = byteOffsets(source, host), length = offsets.at(-1)!, from = Math.min(length, Math.trunc(start - 1)), end = Math.min(length, from + Math.trunc(count));
    if (!offsets.includes(from) || !offsets.includes(end)) return error("#VALUE!");
    return boundedText(chars.slice(0, offsets.indexOf(from)).join("") + replacement + chars.slice(offsets.indexOf(end)).join(""), host);
  }) satisfies FunctionImplementation])),
  SUBSTITUTE: (args, host) => {
    const source = textArg(args, 0, host), search = textArg(args, 1, host), replacement = textArg(args, 2, host), instance = numberArg(args, 3, host, -1);
    if (args[3] !== undefined && instance <= 0) return error("#VALUE!");
    if (!search) return str(source);
    let result = "", from = 0, occurrence = 0;
    while (from <= source.length) {
      host.tick(); const index = source.indexOf(search, from);
      if (index < 0) { result += source.slice(from); break; }
      result += source.slice(from, index) + (++occurrence === Math.trunc(instance) || instance === -1 || Math.trunc(instance) === 0 ? replacement : search);
      if (result.length > host.context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
      from = index + search.length;
    }
    return boundedText(result, host);
  },
  T: (args, host) => { const value = scalarArg(args, 0, host); return value.kind === "string" ? value : blank; },
  VALUE: (args, host) => { const value = scalarArg(args, 0, host); if (value.kind === "blank" || value.kind === "number" || value.kind === "boolean") return value; const n = matchNumber(rendered(value), host); return n === undefined ? error("#VALUE!") : typeof n === "boolean" ? bool(n) : numericResult(n); },
  NUMBERVALUE: (args, host) => {
    const separator = textArg(args, 1, host); if (![".", ","].includes(separator)) return error("#VALUE!");
    const value = scalarArg(args, 0, host); if (value.kind === "blank" || value.kind === "number" || value.kind === "boolean") return value;
    const source = rendered(value).trimStart();
    const n = matchNumber(source, host, separator) ?? matchNumber(source, host); return n === undefined ? error("#VALUE!") : typeof n === "boolean" ? bool(n) : numericResult(n);
  },
  ...Object.fromEntries(["FIXED", "DOLLAR"].map(name => [name, ((args, host) => {
    const n = numberArg(args, 0, host), decimals = Math.trunc(numberArg(args, 1, host, 2));
    if (decimals >= 128) return error("#VALUE!");
    if (!["C", "C.UTF-8", "C.utf8", "en_US", "en_US.UTF-8"].includes(host.context.environment.locale)) unsupported("uncaptured currency/number locale");
    const text = fixedNumber(n, decimals, name === "DOLLAR" || !asBoolean(scalarArg(args, 2, host)));
    return boundedText(name === "DOLLAR" ? text.startsWith("-") ? "($" + text.slice(1) + ")" : "$" + text : text, host);
  }) satisfies FunctionImplementation])),
  TEXT: (args, host) => {
    let value = scalarArg(args, 0, host);
    if (value.kind === "string") {
      const matched = matchNumber(value.value, host);
      if (matched !== undefined) value = typeof matched === "boolean" ? bool(matched) : numericResult(matched);
    }
    const locale = formattingLocale(host.context.environment.locale);
    return formatText(value, canonicalTextPattern(textArg(args, 1, host), locale), {
      book: host.book, context: host.context, tick: host.tick, locale
    });
  },
  ...Object.fromEntries(["TEXTAFTER", "TEXTBEFORE"].map(name => [name, ((args, host) => {
    const source = textArg(args, 0, host), instance = Math.trunc(numberArg(args, 2, host, 1));
    if (!instance) return error("#VALUE!");
    const matches = delimiterMatches(source, args[1]!, undefined, Math.trunc(numberArg(args, 3, host)) === 1, host);
    const selected = matches[instance > 0 ? instance - 1 : matches.length + instance];
    if (selected) return str(name === "TEXTAFTER" ? delimiterSlice(source, selected.end, undefined, host) : delimiterSlice(source, 0, selected.start, host));
    if (Math.trunc(numberArg(args, 4, host)) === 1) return str((name === "TEXTAFTER") === (instance > 0) ? "" : source);
    return args[5] ?? error("#N/A");
  }) satisfies FunctionImplementation])),
  TEXTSPLIT: (args, host) => {
    const source = textArg(args, 0, host), ignore = asBoolean(scalarArg(args, 3, host)), matches = delimiterMatches(source, args[1]!, args[2], Math.trunc(numberArg(args, 4, host)) === 1, host);
    const rows: CellValue[][] = [[]]; let current = rows[0]!, from = 0;
    for (const match of matches) {
      host.tick(); if (!ignore || match.start > from) current.push(str(delimiterSlice(source, from, match.start, host)));
      if (match.row && (!ignore || current.length)) { current = []; rows.push(current); }
      from = match.end;
    }
    if (!ignore || from < byteLength(source)) current.push(str(delimiterSlice(source, from, undefined, host)));
    if (ignore && !current.length && rows.length > 1) rows.pop();
    const width = Math.max(...rows.map(row => row.length));
    if (!width) return blank;
    if (width * rows.length > host.context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
    return admitMatrix(rows.map(row => Array.from({ length: width }, (_, index) => row[index] ?? scalarArg([args[5] ?? error("#N/A")], 0, host))), host);
  }
};
export const textSpecialForms: Readonly<Record<string, SpecialForm>> = {
  ...Object.fromEntries(["CONCAT", "CONCATENATE", "TEXTJOIN"].map(name => [name, ((args, host) => {
    let separator = "", ignore = true, from = 0;
    if (name === "TEXTJOIN") {
      if (args.length < 3) return error("#VALUE!");
      const delimiter = host.scalar(host.evaluate(args[0]!)); if (delimiter.kind === "error") return delimiter; separator = rendered(delimiter);
      const value = host.scalar(host.evaluate(args[1]!)); if (value.kind === "error") return value;
      const b = asBoolean(value); if (b === undefined) return error("#VALUE!"); ignore = b; from = 2;
    }
    let result = "", first = true;
    for (const arg of args.slice(from)) for (const cell of collect(host.evaluate(arg), host)) {
      if (cell.kind === "error") return cell;
      const text = rendered(cell); if (ignore && !text) continue;
      if (!first) result += separator; result += text; first = false;
      if (result.length > host.context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
    }
    return boundedText(result, host);
  }) satisfies SpecialForm]))
};

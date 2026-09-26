import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { repr } from "../cli/parser.js";
import { decimalZeroes, integerWhitespace } from "../unicode-profile.js";
import { stripWhitespace, lowerText } from "../python-text.js";

export class TemporalCastError extends Error {}
export interface TemporalOptions {
  readonly dateFormat?: string;
  readonly datetimeFormat?: string;
  readonly locale?: string;
  readonly now?: number;
  readonly timezone?: string;
}
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const leap = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const monthDays = (year: number, month: number): number => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
interface Parts { year: number; month: number; day: number; hour: number; minute: number; second: number; microsecond: number; offset?: string }
function valid(p: Parts): boolean {
  return p.year >= 1 && p.year <= 9999 && p.month >= 1 && p.month <= 12 && p.day >= 1 && p.day <= monthDays(p.year, p.month) && p.hour >= 0 && p.hour < 24 && p.minute >= 0 && p.minute < 60 && p.second >= 0 && p.second < 60;
}
function dateText(p: Parts): string { return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`; }
function datetimeText(p: Parts): string { return `${dateText(p)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${p.microsecond ? "." + pad(p.microsecond, 6) : ""}${p.offset ?? ""}`; }
function base(year = 1900, month = 1, day = 1): Parts { return { year, month, day, hour: 0, minute: 0, second: 0, microsecond: 0 }; }

/** Proleptic Gregorian ordinals, independent of host Date parsing/timezone data. */
export function ordinal(year: number, month: number, day: number): number {
  const previous = year - 1;
  let days = previous * 365 + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400);
  for (let index = 1; index < month; index++) days += monthDays(year, index);
  return days + day;
}
function fromOrdinal(value: number): Parts {
  if (value < 1 || value > ordinal(9999, 12, 31)) throw new TemporalCastError();
  let year = Math.min(9999, Math.floor((value - 1) / 365.2425) + 1);
  while (ordinal(year, 1, 1) > value) year--;
  while (year < 9999 && ordinal(year + 1, 1, 1) <= value) year++;
  let month = 1;
  while (month < 12 && ordinal(year, month + 1, 1) <= value) month++;
  return base(year, month, value - ordinal(year, month, 1) + 1);
}
function offset(text: string): string {
  if (text === "Z") return "+00:00";
  const m = /^([+-])(\d{2}):?(\d{2})(?::?(\d{2})(?:\.(\d{1,6}))?)?$/.exec(text);
  if (!m || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] ?? 0) > 59) throw new TemporalCastError();
  const seconds = Number(m[4] ?? 0); const micros = Number((m[5] ?? "").padEnd(6, "0"));
  if (!Number(m[2]) && !Number(m[3]) && !seconds && !micros) return "+00:00";
  return `${m[1]}${m[2]}:${m[3]}${seconds || micros ? ":" + pad(seconds) : ""}${micros ? "." + pad(micros, 6) : ""}`;
}

function strptime(text: string, format: string, step: () => void): Parts {
  const p = base(); let position = 0; let ampm: string | undefined; let twelve = false;
  const seen = new Set<string>();
  const consume = (pattern: RegExp): string => {
    const match = pattern.exec(text.slice(position));
    if (!match) throw new TemporalCastError();
    position += match[0].length;
    return match[0];
  };
  for (let index = 0; index < format.length; index++) {
    step();
    const char = format[index]!;
    if (!stripWhitespace(char)) {
      while (index + 1 < format.length && !stripWhitespace(format[index + 1]!)) { step(); index++; }
      const start = position;
      while (position < text.length && !stripWhitespace(text[position]!)) { step(); position++; }
      if (start === position) throw new TemporalCastError();
      continue;
    }
    if (char !== "%") { if (text[position++] !== char) throw new TemporalCastError(); continue; }
    const directive = format[++index];
    if (!directive) throw new TemporalCastError();
    if (seen.has(directive)) throw new CsvkitBlocked(`strptime duplicate group name '${directive}'`);
    if (directive !== "%") seen.add(directive);
    switch (directive) {
      case "%": if (text[position++] !== "%") throw new TemporalCastError(); break;
      case "Y": p.year = Number(consume(/^\d{4}/)); break;
      case "y": { const y = Number(consume(/^\d{2}/)); p.year = y >= 69 ? 1900 + y : 2000 + y; break; }
      case "m": p.month = Number(consume(/^(?:1[0-2]|0[1-9]|[1-9])/)); break;
      case "d": p.day = Number(consume(/^(?:3[0-1]|[1-2]\d|0[1-9]|[1-9]| [1-9])/)); break;
      case "H": p.hour = Number(consume(/^(?:2[0-3]|[01]\d|\d| \d)/)); break;
      case "I": p.hour = Number(consume(/^(?:1[0-2]|0[1-9]|[1-9]| [1-9])/)); twelve = true; if (p.hour < 1 || p.hour > 12) throw new TemporalCastError(); break;
      case "M": p.minute = Number(consume(/^(?:[0-5]\d|\d)/)); break;
      case "S": p.second = Number(consume(/^(?:6[01]|[0-5]\d|\d)/)); break;
      case "f": p.microsecond = Number(consume(/^\d{1,6}/).padEnd(6, "0")); break;
      case "p": ampm = consume(/^(?:am|pm)/i).toLowerCase(); break;
      case "b": case "B": {
        const name = consume(directive === "b" ? /^[a-z]{3}/i : /^[a-z]+/i).toLowerCase();
        p.month = months.findIndex(item => directive === "b" ? item.slice(0, 3) === name : item === name) + 1;
        if (!p.month) throw new TemporalCastError(); break;
      }
      case "a": case "A": {
        const name = consume(directive === "a" ? /^[a-z]{3}/i : /^[a-z]+/i).toLowerCase();
        if (!weekdays.some(item => directive === "a" ? item.slice(0, 3) === name : item === name)) throw new TemporalCastError(); break;
      }
      case "z": p.offset = offset(consume(/^(?:Z|[+-]\d{2}:?\d{2}(?::?\d{2}(?:\.\d{1,6})?)?)/)); break;
      case "Z": consume(/^(?:UTC|GMT)/i); break;
      default: throw new CsvkitBlocked(`strptime directive %${directive}`);
    }
  }
  if (position !== text.length) throw new TemporalCastError();
  if (twelve) p.hour = p.hour % 12 + (ampm === "pm" ? 12 : 0);
  if (!valid(p)) throw new TemporalCastError();
  return p;
}

function implicitDate(text: string, source: Parts, step: () => void): Parts | undefined {
  step();
  // Calendar.nlp normalizes whitespace before its English date grammar.
  let normalized = "";
  for (const char of text) {
    step();
    const code = char.codePointAt(0)!;
    if (integerWhitespace.includes(code) || code >= 0x1c && code <= 0x1f) {
      if (!normalized.endsWith(" ")) normalized += " ";
    } else normalized += char;
  }
  text = normalized;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) {
    const first = Number(m[1]);
    let year = first <= 31 ? Number(m[3]) : first;
    year += year < 50 ? 2000 : year < 100 ? 1900 : 0;
    return base(year, first <= 31 ? first : Number(m[2]), first <= 31 ? Number(m[2]) : Number(m[3]));
  }
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text);
  if (m) {
    let year = m[3] ? Number(m[3]) : source.year;
    if (m[3]?.length === 2) year += year >= 50 ? 1900 : 2000;
    const month = Number(m[1]); const day = Number(m[2]);
    if (!m[3] && (month < source.month || month === source.month && day < source.day)) year++;
    // parsedatetime maps missing years below 1900 through its 2000-century rule.
    if (!m[3] && year < 100) year += 2000;
    return base(year, month, day);
  }
  m = /^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/i.exec(text);
  if (m && months.some(name => name === m![1]!.toLowerCase() || name.slice(0, 3) === m![1]!.toLowerCase())) {
    const month = months.findIndex(name => name === m![1]!.toLowerCase() || name.slice(0, 3) === m![1]!.toLowerCase()) + 1;
    let year = m[3] ? Number(m[3]) : source.year;
    if (!m[3] && (month < source.month || month === source.month && Number(m[2]) < source.day)) year++;
    return base(year, month, Number(m[2]));
  }
  const lower = text.toLowerCase(); const start = ordinal(source.year, source.month, source.day);
  if (["today", "tomorrow", "yesterday"].includes(lower)) return fromOrdinal(start + (lower === "tomorrow" ? 1 : lower === "yesterday" ? -1 : 0));
  const weekday = weekdays.indexOf(lower);
  if (weekday >= 0) return fromOrdinal(start + ((weekday - (start - 1) % 7 + 7) % 7 || 7));
  if (lower === "next week") return fromOrdinal(start + 7);
  return undefined;
}

export function temporalDate(type: "Date" | "DateTime", text: string, options: TemporalOptions, step: () => void): { kind: "date" | "datetime"; value: string } {
  const format = type === "Date" ? options.dateFormat : options.datetimeFormat;
  let nlpAbsent: boolean | undefined;
  const failure = (): never => { throw new TemporalCastError(format || type === "Date" && nlpAbsent ? `Value "${text}" does not match date format.` : `Can not parse value "${text}" as ${type === "Date" ? "date" : "datetime"}.`); };
  // Frozen parsedatetime rejects these standalone tokens as temporal values.
  if (!format && ["second", "last"].includes(text.toLowerCase())) return failure();
  if (format && options.locale && options.locale !== "en_US") throw new CsvkitBlocked(`LC_TIME strptime locale ${options.locale}`);
  if (options.locale && !["en_US", "en_US.UTF-8"].includes(options.locale)) throw new CsvkitBlocked(`parsedatetime locale ${options.locale}`);
  let p: Parts | undefined;
  try {
    if (format) p = strptime(text, format, step);
    else {
      if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/.test(text)) throw new TemporalCastError();
      // Python timedelta's comma form does not match a complete parsedatetime
      // expression, even though pytimeparse accepts it as a duration.
      if (/^[+-]?\d+ days?, \d{1,2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(text)) throw new TemporalCastError();
      // Neither parsedatetime nor pytimeparse accepts these subsecond unit
      // abbreviations. A failed temporal hypothesis must allow text inference.
      if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:ms|us)$/i.test(text)) throw new TemporalCastError();
      // Python re.IGNORECASE admits dotless i and long s, but parsedatetime's
      // lowercase unit dictionary does not contain those matched spellings.
      const unit = /\d\s*([a-zſıİK]+)$/iu.exec(text)?.[1];
      if (unit) {
        const folded = unit.replace(/[ſıİK]/gu, char => char === "ſ" ? "s" : char === "K" ? "k" : "i").toLowerCase();
        const aliases = ["seconds", "minutes", "second", "minute", "months", "hours", "weeks", "month", "years", "secs", "mins", "hour", "days", "week", "year", "sec", "min", "day", "mth", "hr", "dy", "wk", "yr", "s", "m", "h", "d", "w", "y"];
        if (type === "Date" && aliases.includes(folded) && /[ſı]/u.test(unit)) throw new CsvkitDiagnostic(`KeyError: ${repr(lowerText(unit))}`);
        if (aliases.includes(folded) && (unit.includes("İ") || type === "DateTime" && /[ſı]/u.test(unit))) throw new TemporalCastError();
      }
      let source = base(1);
      if (type === "DateTime") {
        if (options.timezone && options.timezone !== "UTC") throw new CsvkitBlocked(`clock timezone ${options.timezone}`);
        if (options.now === undefined && /^(?:today|tomorrow|yesterday|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}|[a-z]+ \d{1,2})$/i.test(text)) throw new CsvkitBlocked("DateTime injected clock");
        if (options.now !== undefined && !Number.isFinite(options.now)) throw new CsvkitBlocked("DateTime clock range");
        source = fromOrdinal(Math.floor((options.now ?? 0) / 86400000) + ordinal(1970, 1, 1));
      }
      p = implicitDate(text, source, step);
      const relative = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-zK]+)$/iu.exec(text);
      if (!p && relative) {
        const unit = lowerText(relative[2]!);
        if (["s", "sec", "secs", "second", "seconds", "m", "min", "mins", "minute", "minutes", "h", "hr", "hrs", "hour", "hours"].includes(unit)) { nlpAbsent = false; throw new TemporalCastError(); }
        if (["d", "dy", "dys", "day", "days", "w", "wk", "wks", "week", "weeks"].includes(unit)) {
          const days = Number(relative[1]) * (unit.startsWith("w") ? 7 : 1);
          if (!Number.isFinite(days)) throw new TemporalCastError();
          nlpAbsent = false;
          p = fromOrdinal(ordinal(source.year, source.month, source.day) + Math.floor(days));
        }
      }
      nlpAbsent = !p && !/\d.*[-/:]|\b(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text);
      if (!p && type === "DateTime") {
        const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
        if (m) {
          p = { ...base(Number(m[1]), Number(m[2]), Number(m[3])), hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6] ?? 0), microsecond: Number((m[7] ?? "").slice(0, 6).padEnd(6, "0")), ...(m[8] ? { offset: offset(m[8]) } : {}) };
        }
      }
      if (!p && !/^\d{4}-\d{2}-\d{2}[T ]/.test(text) && /(?:\b(?:next|last|ago|week|month|year|day|hour|minute|second|noon|midnight|tonight)\b|\d.*[a-z])/i.test(text)) throw new CsvkitBlocked("parsedatetime expression " + repr(text));
    }
    if (!p || !valid(p)) failure();
    return { kind: type === "Date" ? "date" : "datetime", value: type === "Date" ? dateText(p!) : datetimeText(p!) };
  } catch (error) { if (error instanceof TemporalCastError) { if (!format && !p && type === "Date" && nlpAbsent === undefined) nlpAbsent = true; failure(); } throw error; }
}

/** Frozen pytimeparse grammar; numeric expressions intentionally preserve its sign quirk. */
export function duration(text: string, step: () => void): { kind: "timedelta"; microseconds: bigint } {
  step();
  let normalized = "";
  for (const char of text) {
    step();
    const code = char.codePointAt(0)!;
    const zero = decimalZeroes.find(start => code >= start && code < start + 10);
    normalized += zero !== undefined ? String(code - zero) : integerWhitespace.includes(code) || code >= 0x1c && code <= 0x1f ? " " : char === "ſ" ? "s" : char === "İ" || char === "ı" ? "i" : char === "K" ? "k" : char;
  }
  const sign = normalized[0] === "-" ? -1 : 1;
  const unsigned = stripWhitespace(["-", "+", "|"].includes(normalized[0] ?? "") ? normalized.slice(1) : normalized);
  const units = ["(?:w|wks?|weeks?)", "(?:d|dys?|days?)", "(?:h|hrs?|hours?)", "(?:m|mins?|minutes?)", "(?:s|secs?|seconds?)"];
  const named = units.map((unit, index) => `(?:([\\d.]+)\\s*${unit}${index === 4 ? "" : "\\s*(?:[,/]\\s*)?"})?`).join("\\s*");
  const patterns = [new RegExp(`^\\s*${named}\\s*$`, "i"), /^(\d{1,2}):(\d{2}(?:\.\d+)?)$/, new RegExp(`^(?:([\\d.]+)\\s*${units[0]}\\s*(?:[,/]\\s*)?)?\\s*(?:([\\d.]+)\\s*${units[1]}\\s*(?:[,/]\\s*)?)?\\s*(\\d+):(\\d{2}):(\\d{2}(?:\\.\\d+)?)$`, "i"), /^(\d+):(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/, /^:(\d{2}(?:\.\d+)?)$/];
  let fields: (string | undefined)[] | undefined;
  for (const [index, pattern] of patterns.entries()) {
    step(); const m = pattern.exec(unsigned);
    if (!m || !m.slice(1).some(Boolean)) continue;
    fields = index === 0 || index === 2 ? m.slice(1) : index === 1 ? [undefined, undefined, undefined, m[1], m[2]] : index === 3 ? [undefined, ...m.slice(1)] : [undefined, undefined, undefined, undefined, m[1]];
    break;
  }
  if (!fields) throw new TemporalCastError(`Can not parse value "${text}" to as timedelta.`);
  const multipliers = [604800, 86400, 3600, 60, 1];
  for (const field of fields) if (field && !/^\d+(?:\.\d*)?$|^\.\d+$/.test(field)) throw new CsvkitDiagnostic(`ValueError: could not convert string to float: ${repr(field)}`);
  const integers = fields.every(value => !value || /^\d+$/.test(value));
  let micros: bigint;
  if (integers) micros = BigInt(sign) * fields.reduce((total, field, index) => total + BigInt(field ?? 0) * BigInt(multipliers[index]!), 0n) * 1000000n;
  else {
    let seconds: number;
    if (!fields[4] || /^\d+$/.test(fields[4])) seconds = sign * Math.trunc(fields.slice(0, 4).reduce((total, field, index) => total + Number(field ?? 0) * multipliers[index]!, 0)) + Number(fields[4] ?? 0);
    else seconds = sign * fields.reduce((total, field, index) => total + Number(field ?? 0) * multipliers[index]!, 0);
    if (!Number.isFinite(seconds) || Math.abs(seconds * 1000000) > Number.MAX_SAFE_INTEGER) throw new CsvkitBlocked("timedelta float range");
    const whole = Math.trunc(seconds);
    const value = (seconds - whole) * 1000000; const floor = Math.floor(value); const fraction = value - floor;
    micros = BigInt(whole) * 1000000n + BigInt(fraction > 0.5 || fraction === 0.5 && floor % 2 !== 0 ? floor + 1 : floor);
  }
  const days = micros < 0n ? (micros - 86399999999n) / 86400000000n : micros / 86400000000n;
  if (days < -999999999n || days > 999999999n) throw new CsvkitDiagnostic(`OverflowError: Python int too large to convert to C int`);
  return { kind: "timedelta", microseconds: micros };
}

export function temporalOrder(value: string): bigint {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2})(?:\.(\d{6}))?([+-]\d{2}:\d{2}(?::\d{2}(?:\.\d{6})?)?)?)?$/.exec(value);
  if (!m) throw new CsvkitBlocked("temporal ordering offset profile");
  let result = BigInt(ordinal(Number(m[1]), Number(m[2]), Number(m[3]))) * 86400000000n + BigInt(Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000000n + BigInt(m[7] ?? 0);
  if (m[8]) {
    const zone = m[8];
    const seconds = Number(zone.slice(1, 3)) * 3600 + Number(zone.slice(4, 6)) * 60 + Number(zone.slice(7, 9) || 0);
    const micros = BigInt(seconds) * 1000000n + BigInt(zone.slice(10) || 0);
    result -= (zone[0] === "-" ? -1n : 1n) * micros;
  }
  return result;
}

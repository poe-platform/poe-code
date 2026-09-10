import { canonicalizeIntlOffsetZone } from "./intl-offset-zone.js";
import { validateTemporalOffset } from "./temporal-offset-validation.js";

const digits = (text: string) => text.length > 0 && [...text].every(char => char >= "0" && char <= "9");
const alpha = (char: string) => char >= "A" && char <= "Z" || char >= "a" && char <= "z";

function namedZone(text: string): boolean {
  return text.split("/").every(part => part.length > 0 && (alpha(part[0]) || part[0] === "." || part[0] === "_")
    && [...part].every(char => alpha(char) || digits(char) || "._+-".includes(char)));
}

function validDay(year: number, month: number, day: number): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = month === 2 ? leap ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return month >= 1 && month <= 12 && day >= 1 && day <= length;
}

function dateBody(text: string, yearMonth = false): boolean {
  const signed = text[0] === "+" || text[0] === "-";
  const yearLength = signed ? 7 : 4;
  const year = text.slice(0, yearLength);
  if (year.length !== yearLength || !digits(signed ? year.slice(1) : year) || year === "-000000") return false;
  const suffix = text.slice(yearLength);
  const parts = suffix[0] === "-" ? suffix.slice(1).split("-")
    : yearMonth ? [suffix] : [suffix.slice(0, 2), suffix.slice(2)];
  if (parts.length !== (yearMonth ? 1 : 2) || parts.some(part => part.length !== 2 || !digits(part))) return false;
  return validDay(Number(year), Number(parts[0]), yearMonth ? 1 : Number(parts[1]));
}

function monthDayBody(text: string): boolean {
  const body = text.startsWith("--") ? text.slice(2) : text;
  const parts = body.includes("-") ? body.split("-") : [body.slice(0, 2), body.slice(2)];
  return parts.length === 2 && parts.every(part => part.length === 2 && digits(part))
    && validDay(1972, Number(parts[0]), Number(parts[1]));
}

function clockBody(text: string, allowZ: boolean): { offset?: string; z?: boolean } | undefined {
  let cursor = 0;
  const extended = text[2] === ":";
  for (let component = 0; component < 3; component++) {
    if (component > 0) {
      if (extended) {
        if (text[cursor] !== ":") break;
        cursor++;
      } else if (!digits(text[cursor] ?? "")) break;
    }
    const part = text.slice(cursor, cursor + 2);
    if (part.length !== 2 || !digits(part) || Number(part) > [23, 59, 60][component]) return undefined;
    cursor += 2;
    if (component === 2 && (text[cursor] === "." || text[cursor] === ",")) {
      const start = ++cursor;
      while (digits(text[cursor] ?? "")) cursor++;
      if (cursor === start || cursor - start > 9) return undefined;
    }
  }
  const suffix = text.slice(cursor);
  if (!suffix) return {};
  if (allowZ && (suffix === "Z" || suffix === "z")) return { z: true };
  try { validateTemporalOffset(suffix); return { offset: suffix }; }
  catch (error) { if (!(error instanceof RangeError)) throw error; return undefined; }
}

// ParseTemporalTimeZoneString's complete union of ISO formats. This returns a
// syntactic identifier; callers must still resolve names against IANA data.
// It does not impose Temporal value range limits on the date used as syntax.
export function parseTemporalTimeZoneString(input: string): string {
  if (namedZone(input)) return input;
  try {
    const offset = canonicalizeIntlOffsetZone(input);
    if (offset !== undefined) return offset;
  } catch (error) { if (!(error instanceof RangeError)) throw error; }

  const firstBracket = input.indexOf("[");
  const body = firstBracket < 0 ? input : input.slice(0, firstBracket);
  let zone: string | undefined;
  let calendar: string | undefined;
  let calendarCritical = false;
  let position = firstBracket < 0 ? input.length : firstBracket;
  while (position < input.length) {
    if (input[position] !== "[") throw new RangeError("Invalid Temporal annotation.");
    const end = input.indexOf("]", position + 1);
    if (end < 0) throw new RangeError("Unclosed Temporal annotation.");
    const critical = input[position + 1] === "!";
    const annotation = input.slice(position + (critical ? 2 : 1), end);
    const equals = annotation.indexOf("=");
    if (equals < 0) {
      if (position !== firstBracket) throw new RangeError("Time zone annotation must come first.");
      zone = canonicalizeIntlOffsetZone(annotation);
      if (zone === undefined) {
        if (!namedZone(annotation)) throw new RangeError("Invalid time zone annotation.");
        zone = annotation;
      }
    } else {
      const key = annotation.slice(0, equals);
      const value = annotation.slice(equals + 1);
      if (!key || !(key[0] >= "a" && key[0] <= "z" || key[0] === "_")
        || [...key].some(char => !(char >= "a" && char <= "z" || digits(char) || char === "_" || char === "-"))
        || !value.split("-").every(part => part.length > 0 && [...part].every(char => alpha(char) || digits(char))))
        throw new RangeError("Invalid Temporal annotation.");
      if (key === "u-ca") {
        if (calendar !== undefined && (critical || calendarCritical)) throw new RangeError("Duplicate critical calendar.");
        if (calendar === undefined) { calendar = value; calendarCritical = critical; }
      } else if (critical) throw new RangeError("Unknown critical annotation.");
    }
    position = end + 1;
  }

  let parsed: { offset?: string; z?: boolean } | undefined;
  let partialDate = false;
  const separator = [...body].findIndex(char => char === "T" || char === "t" || char === " ");
  if (separator > 0 && dateBody(body.slice(0, separator))) parsed = clockBody(body.slice(separator + 1), true);
  else if (dateBody(body)) parsed = {};
  else {
    const designated = body[0] === "T" || body[0] === "t";
    // The grammar disallows an undesignated time that is also a valid partial
    // date. Invalid partial dates (e.g. 0230) can still be valid clock times.
    partialDate = !designated && (monthDayBody(body) || dateBody(body, true));
    parsed = partialDate ? {} : clockBody(designated ? body.slice(1) : body, false);
  }
  if (parsed === undefined || partialDate && calendar !== undefined && calendar.toLowerCase() !== "iso8601")
    throw new RangeError("Invalid Temporal time zone string.");
  if (zone !== undefined) return zone;
  if (parsed.z) return "UTC";
  if (parsed.offset !== undefined) return canonicalizeIntlOffsetZone(parsed.offset)!;
  throw new RangeError("Temporal string has no time zone.");
}

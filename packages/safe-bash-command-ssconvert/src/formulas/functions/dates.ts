import { SsconvertError } from "../../contracts.js";
import { error, numericResult } from "../values.js";
import { collect, numberArg, textArg } from "./common.js";
import { fakeFloor } from "./floating-point.js";
import type { FunctionHost, FunctionImplementation } from "./types.js";

const DAY = 86400000;
/** Gregorian arithmetic is UTC-only; local time enters solely through the injected clock. */
export function gregorian(year: number, month: number, day: number): Date {
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0); return date;
}
export function serialDate(serial: number, host: Pick<FunctionHost, "book">): Date | undefined {
  if (!Number.isFinite(serial) || serial < -2147483648 || serial >= 2147483647) return undefined;
  const day = Math.floor(serial + 0.5 / 86400), mac = host.book.dateSystem === "1904";
  if (!mac && day === 60) return undefined;
  const date = new Date((day - (mac ? 24107 : day < 60 ? 25568 : 25569)) * DAY);
  return date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 65535 ? date : undefined;
}
export function dateSerial(date: Date, host: Pick<FunctionHost, "book">): number {
  const whole = gregorian(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()).getTime();
  const raw = whole / DAY;
  return raw + (host.book.dateSystem === "1904" ? 24107 : raw < -25508 ? 25568 : 25569) + (date.getTime() - whole) / DAY;
}
export function shiftMonths(date: Date, months: number, eom = false): Date {
  const shifted = gregorian(date.getUTCFullYear(), date.getUTCMonth() + 1 + months, 1);
  const last = gregorian(shifted.getUTCFullYear(), shifted.getUTCMonth() + 2, 0).getUTCDate();
  shifted.setUTCDate(eom ? last : Math.min(last, date.getUTCDate())); return shifted;
}
export function leapYear(year: number): boolean { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
export function dayCount(from: Date, to: Date, basis: number): number {
  if (from > to) return -dayCount(to, from, basis);
  if ([1, 2, 3].includes(basis)) return (to.getTime() - from.getTime()) / DAY;
  let d1 = from.getUTCDate(), d2 = to.getUTCDate();
  const m1 = from.getUTCMonth() + 1; let m2 = to.getUTCMonth() + 1;
  if (basis === 4) { d1 = Math.min(d1, 30); d2 = Math.min(d2, 30); }
  else if (basis === 5) {
    if (d1 === 31) d1 = 30;
    if (d2 === 31) { d2 = 1; m2++; }
  }
  else if (basis === 6) {
    if (m1 === 2 && d1 === gregorian(from.getUTCFullYear(), 3, 0).getUTCDate()) d1 = 30;
    if (m2 === 2 && d2 === gregorian(to.getUTCFullYear(), 3, 0).getUTCDate()) d2 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
  }
  else {
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 === 30) d2 = 30;
    if (m1 === 2 && d1 === gregorian(from.getUTCFullYear(), 3, 0).getUTCDate()) {
      if (m2 === 2 && d2 === gregorian(to.getUTCFullYear(), 3, 0).getUTCDate()) d2 = 30;
      d1 = 30;
    }
  }
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 360 + (m2 - m1) * 30 + d2 - d1;
}
export function yearFraction(from: Date, to: Date, basis: number): number {
  if (from > to) return yearFraction(to, from, basis);
  const days = dayCount(from, to, basis);
  if (basis !== 1) return days / (basis === 3 ? 365 : [0, 2, 4].includes(basis) ? 360 : -1);
  const y1 = from.getUTCFullYear(), y2 = to.getUTCFullYear();
  let denominator: number;
  if (to > shiftMonths(from, 12)) denominator = (gregorian(y2 + 1, 1, 1).getTime() - gregorian(y1, 1, 1).getTime()) / DAY / (y2 + 1 - y1);
  else denominator = 365 + Number(leapYear(y1) && from.getUTCMonth() < 2 || leapYear(y2) && (to.getUTCMonth() > 1 || to.getUTCMonth() === 1 && to.getUTCDate() >= 29));
  return days / denominator;
}
export function localNow(host: FunctionHost): Date {
  if (!host.context.clock) throw new SsconvertError("capability-denied", "ssconvert time functions require an explicit clock");
  const now = host.context.clock.now(); host.tick();
  if (!Number.isFinite(now) || Math.abs(now) > 8640000000000000)
    throw new SsconvertError("invalid-request", "Invalid ssconvert clock result");
  return zonedDate(now, host);
}
function zonedDate(now: number, host: FunctionHost): Date {
  if (host.context.environment.timezone === "UTC") return new Date(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: host.context.environment.timezone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(now);
  } catch { throw new SsconvertError("invalid-request", "Invalid ssconvert timezone"); }
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  const date = gregorian(part("year"), part("month"), part("day")); date.setUTCHours(part("hour"), part("minute"), part("second"), ((now % 1000) + 1000) % 1000); return date;
}
function isoWeek(date: Date): number {
  const thursday = new Date(date); thursday.setUTCDate(date.getUTCDate() + 3 - (date.getUTCDay() + 6) % 7);
  return 1 + Math.floor((thursday.getTime() - gregorian(thursday.getUTCFullYear(), 1, 1).getTime()) / DAY / 7);
}
export const dateFunctions: Readonly<Record<string, FunctionImplementation>> = {
  DATE: (a, h) => {
    let year = numberArg(a, 0, h); const month = Math.floor(numberArg(a, 1, h)); let day = Math.floor(numberArg(a, 2, h));
    if (year < 0 || year >= 10000 || Math.abs(month) > 120000) return error("#NUM!");
    if (year < 1000) year += 1900;
    if (day < -32768 || day >= 32768) day = 32767;
    const date = gregorian(Math.trunc(year), month, day);
    return date.getUTCFullYear() < 1582 || date.getUTCFullYear() >= 11900 ? error("#NUM!") : numericResult(dateSerial(date, h));
  },
  DATEVALUE: (a, h) => { const n = numberArg(a, 0, h); return numericResult(n >= 2147483647 || n < -2147483648 ? 2147483647 : Math.floor(n + 0.5 / 86400)); },
  TIMEVALUE: (a, h) => { const n = numberArg(a, 0, h); return numericResult(n - Math.trunc(n)); },
  TIME: (a, h) => { const hour = numberArg(a, 0, h) % 24, minute = numberArg(a, 1, h), second = numberArg(a, 2, h); const n = (hour * 3600 + minute * 60 + second) / 86400; return hour < 0 || minute < 0 || second < 0 ? error("#NUM!") : numericResult(n - Math.floor(n)); },
  "ODF.TIME": (a, h) => numericResult((numberArg(a, 0, h) * 3600 + numberArg(a, 1, h) * 60 + numberArg(a, 2, h)) / 86400),
  NOW: (_a, h) => numericResult(dateSerial(localNow(h), h)),
  TODAY: (_a, h) => numericResult(Math.floor(dateSerial(localNow(h), h))),
  UNIX2DATE: (a, h) => {
    const n = numberArg(a, 0, h), whole = Math.trunc(n);
    if (!Number.isFinite(n) || Math.abs(n) > 8640000000000) return error("#VALUE!");
    return numericResult(dateSerial(zonedDate(whole * 1000, h), h) + (n - whole) / 86400);
  },
  DATE2UNIX: (a, h) => {
    const n = numberArg(a, 0, h), d = serialDate(Math.trunc(n), h);
    if (!d) return error("#VALUE!");
    const wall = d.getTime(); let epoch = wall;
    for (let i = 0; i < 4; i++) {
      h.tick(); const difference = wall - zonedDate(epoch, h).getTime();
      if (!difference) break;
      epoch += difference;
    }
    const seconds = (n - Math.trunc(n)) * 86400;
    if (epoch / 1000 === -1) return error("#VALUE!");
    const unix = epoch / 1000 + Math.sign(seconds) * fakeFloor(Math.abs(seconds) + .5);
    // value_new_int(int) narrows the double; captured GCC ARM64 saturates overflow.
    return numericResult(Math.max(-2147483648, Math.min(2147483647, Math.trunc(unix))));
  },
  ...Object.fromEntries(["YEAR", "MONTH", "DAY"].map(name => [name, ((a, h) => {
    const date = serialDate(numberArg(a, 0, h), h); return date ? numericResult(name === "YEAR" ? date.getUTCFullYear() : name === "MONTH" ? date.getUTCMonth() + 1 : date.getUTCDate()) : error("#NUM!");
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["HOUR", "MINUTE", "SECOND"].map(name => [name, ((a, h) => {
    const n = numberArg(a, 0, h); const seconds = Math.round((n - Math.floor(n)) * 86400) % 86400;
    return n >= 2147483647 || n < -2147483648 ? error("#NUM!") : numericResult(name === "HOUR" ? Math.floor(seconds / 3600) : name === "MINUTE" ? Math.floor(seconds / 60) % 60 : seconds % 60);
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["EDATE", "EOMONTH"].map(name => [name, ((a, h) => {
    const n = numberArg(a, 0, h), months = numberArg(a, 1, h), date = serialDate(n, h);
    if (!date) return error(name === "EDATE" ? "#NUM!" : "#VALUE!");
    if (name === "EDATE" && n < 0 || Math.abs(months) > 1073741823) return error("#NUM!");
    const shifted = shiftMonths(date, Math.trunc(months), name === "EOMONTH");
    return shifted.getUTCFullYear() < 1900 || shifted.getUTCFullYear() > 9999 ? error("#NUM!") : numericResult(dateSerial(shifted, h));
  }) satisfies FunctionImplementation])),
  WEEKDAY: (a, h) => {
    const date = serialDate(numberArg(a, 0, h), h), method = Math.trunc(numberArg(a, 1, h, 1));
    if (!date || ![1, 2, 3, 11, 12, 13, 14, 15, 16, 17].includes(method)) return error("#NUM!");
    const start = method === 1 || method === 17 ? 0 : method <= 3 ? 1 : method - 10;
    return numericResult((date.getUTCDay() - start + 7) % 7 + (method === 3 ? 0 : 1));
  },
  ISOWEEKNUM: (a, h) => { const date = serialDate(numberArg(a, 0, h), h); return date ? numericResult(isoWeek(date)) : error("#VALUE!"); },
  ISOYEAR: (a, h) => {
    const date = serialDate(numberArg(a, 0, h), h);
    if (!date) return error("#VALUE!");
    const week = isoWeek(date), month = date.getUTCMonth();
    return numericResult(date.getUTCFullYear() + (week >= 52 && month === 0 ? -1 : week === 1 && month === 11 ? 1 : 0));
  },
  WEEKNUM: (a, h) => {
    const date = serialDate(numberArg(a, 0, h), h), method = Math.floor(numberArg(a, 1, h, 1));
    if (!date || ![1, 2, 21, 150].includes(method)) return error("#VALUE!");
    const first = gregorian(date.getUTCFullYear(), 1, 1), offset = method === 1 ? first.getUTCDay() : (first.getUTCDay() + 6) % 7;
    return numericResult(method > 2 ? isoWeek(date) : 1 + Math.floor(((date.getTime() - first.getTime()) / DAY + offset) / 7));
  },
  DAYS: (a, h) => { const to = serialDate(Math.floor(numberArg(a, 0, h)), h), from = serialDate(Math.floor(numberArg(a, 1, h)), h); return from && to ? numericResult(dayCount(from, to, 1)) : error("#VALUE!"); },
  DAYS360: (a, h) => {
    const from = serialDate(numberArg(a, 0, h), h), to = serialDate(numberArg(a, 1, h), h), method = Math.floor(numberArg(a, 2, h));
    return from && to ? numericResult(dayCount(from, to, method === 0 ? 0 : method === 2 ? 6 : 4)) : error("#VALUE!");
  },
  YEARFRAC: (a, h) => {
    const from = serialDate(numberArg(a, 0, h), h), to = serialDate(numberArg(a, 1, h), h), rawBasis = numberArg(a, 2, h), basis = Math.trunc(rawBasis);
    return !from || !to || rawBasis < 0 || basis > 4 ? error("#NUM!") : numericResult(yearFraction(from, to, basis));
  },
  DATEDIF: (a, h) => {
    const n1 = Math.floor(numberArg(a, 0, h)), n2 = Math.floor(numberArg(a, 1, h));
    if (n1 > n2) return error("#NUM!");
    const from = serialDate(n1, h), to = serialDate(n2, h), unit = textArg(a, 2, h);
    if (!from || !to) return error("#VALUE!");
    const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() - Number(to.getUTCDate() < from.getUTCDate()), years = Math.floor(months / 12);
    if (unit === "d") return numericResult(dayCount(from, to, 1));
    if (unit === "m" || unit === "y" || unit === "ym") return numericResult(unit === "m" ? months : unit === "y" ? years : months % 12);
    if (unit !== "md" && unit !== "yd") return error("#VALUE!");
    const adjusted = shiftMonths(from, unit === "md" ? months : years * 12), y1 = 2004 + (adjusted.getUTCFullYear() & 3), y2 = y1 + to.getUTCFullYear() - adjusted.getUTCFullYear();
    const start = gregorian(y1, adjusted.getUTCMonth() + 1, adjusted.getUTCDate()), end = gregorian(y2, to.getUTCMonth() + 1, to.getUTCDate());
    if (unit === "md") start.setUTCDate(start.getUTCDate() + from.getUTCDate() - adjusted.getUTCDate());
    return numericResult(dayCount(start, end, 1));
  },
  ...Object.fromEntries(["WORKDAY", "NETWORKDAYS"].map(name => [name, ((a, h) => {
    const start = Math.floor(numberArg(a, 0, h) + 0.5 / 86400), input = numberArg(a, 1, h);
    const date = serialDate(start, h);
    const end = Math.floor(input + 0.5 / 86400);
    if (name === "NETWORKDAYS" && (start <= 0 || end <= 0)) return error("#NUM!");
    if (!date) return error("#VALUE!");
    if (name === "NETWORKDAYS" && !serialDate(end, h)) return error("#VALUE!");
    if (name === "WORKDAY" && Math.abs(input) > 1073741823) return error("#NUM!");
    const weekend: number[] = [];
    if (a[3]) for (const value of collect(a[3], h)) {
      if (value.kind === "blank") continue;
      if (value.kind === "error") return value;
      weekend.push(numberArg([value], 0, h));
    } else weekend.push(1, 0, 0, 0, 0, 0, 1);
    if (weekend.length !== 7 || weekend.some(Number.isNaN)) return error("#VALUE!");
    if (name === "NETWORKDAYS") {
      if (weekend.every(n => n !== 0)) return numericResult(0);
    } else {
      if (weekend.every(n => n !== 0)) return Math.trunc(input) ? error("#VALUE!") : numericResult(dateSerial(date, h));
    }
    const holidays = new Set<number>();
    if (a[2]) for (const value of collect(a[2], h)) {
      if (value.kind === "blank" || value.kind === "boolean") continue;
      if (value.kind === "error") return value;
      const n = numberArg([value], 0, h), d = serialDate(Math.trunc(n), h);
      if (!d || n < 0) return error("#VALUE!");
      holidays.add(Math.trunc(n));
    }
    const working = (d: Date) => weekend[d.getUTCDay()] === 0 && !holidays.has(dateSerial(d, h));
    if (name === "NETWORKDAYS") {
      const other = serialDate(end, h)!;
      const first = date < other ? date : other, last = date < other ? other : date;
      const days = dayCount(first, last, 1) + 1, weeks = Math.floor(days / 7);
      let result = weeks * weekend.filter(n => n === 0).length;
      const cursor = new Date(first); cursor.setUTCDate(cursor.getUTCDate() + weeks * 7);
      for (; cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) { h.tick(); if (weekend[cursor.getUTCDay()] === 0) result++; }
      for (const holiday of holidays) { h.tick(); const d = serialDate(holiday, h)!; if (d >= first && d <= last && weekend[d.getUTCDay()] === 0) result--; }
      return numericResult(result);
    }
    let remaining = Math.abs(Math.trunc(input)); const step = input < 0 ? -1 : 1;
    if (weekend.every(n => n !== 0) && remaining) return error("#VALUE!");
    if (remaining) while (weekend[date.getUTCDay()] !== 0) { h.tick(); date.setUTCDate(date.getUTCDate() - step); }
    while (remaining) { h.tick(); date.setUTCDate(date.getUTCDate() + step); if (working(date)) remaining--; }
    return date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 9999 ? error("#NUM!") : numericResult(dateSerial(date, h));
  }) satisfies FunctionImplementation]))
};

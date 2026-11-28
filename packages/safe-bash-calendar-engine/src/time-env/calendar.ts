import moment from "moment-timezone";
import { CommandFailure } from "./shared.js";

export const nanosecondsPerSecond = 1000000000n;
const maximumNanoseconds = 8640000000000000000000n;
export const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export interface CalendarFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export interface ZonedFields extends CalendarFields {
  readonly offset: number;
  readonly zone: string;
}

export function floorDivide(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value < 0n && value % divisor !== 0n ? quotient - 1n : quotient;
}

export function boundedInstant(value: bigint): bigint {
  if (value < -maximumNanoseconds || value > maximumNanoseconds) throw new CommandFailure("date is outside the supported range");
  return value;
}

export function millisecondsInstant(value: number): bigint {
  if (!Number.isFinite(value) || Math.abs(value) > 8640000000000000) throw new CommandFailure("invalid clock or modification time");
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(value.toString())!;
  const fraction = match[3] ?? "";
  const coefficient = BigInt(`${match[2]}${fraction}`) * (match[1] ? -1n : 1n);
  const scale = Number(match[4] ?? 0) - fraction.length + 6;
  return boundedInstant(scale >= 0 ? coefficient * 10n ** BigInt(scale) : floorDivide(coefficient, 10n ** BigInt(-scale)));
}

export function utcMilliseconds(fields: CalendarFields): number {
  const date = new Date(0);
  date.setUTCFullYear(fields.year, fields.month - 1, fields.day);
  date.setUTCHours(fields.hour, fields.minute, fields.second, 0);
  const value = date.getTime();
  if (!Number.isFinite(value)) throw new CommandFailure("date is outside the supported range");
  return value;
}

function utcFields(milliseconds: number): CalendarFields {
  const date = new Date(milliseconds);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds() };
}

function sameFields(left: CalendarFields, right: CalendarFields): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

function checkCalendar(fields: CalendarFields, restrictYear = true): void {
  if ((restrictYear && (fields.year < -9999 || fields.year > 9999)) || fields.month < 1 || fields.month > 12 || fields.day < 1 || fields.day > 31
    || fields.hour < 0 || fields.hour > 23 || fields.minute < 0 || fields.minute > 59 || fields.second < 0 || fields.second > 59
    || !sameFields(fields, utcFields(utcMilliseconds(fields)))) throw new CommandFailure("invalid calendar date or time");
}

function signedOffset(text: string): number {
  const match = /^([+-])(\d{2})(?::?(\d{2}))?(?::(\d{2}))?$/.exec(text);
  if (!match) throw new CommandFailure(`unsupported UTC offset: ${text}`);
  const hours = Number(match[2]), minutes = Number(match[3] ?? 0), seconds = Number(match[4] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) throw new CommandFailure(`invalid UTC offset: ${text}`);
  return (match[1] === "-" ? -1 : 1) * (hours * 3600 + minutes * 60 + seconds);
}

function posixSeconds(text: string, maximumHours: number, input: string): number {
  const match = /^([+-]?)(\d{1,3})(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(text);
  if (!match || Number(match[2]) > maximumHours || Number(match[3] ?? 0) > 59 || Number(match[4] ?? 0) > 59) {
    throw new CommandFailure(`unsupported virtual TZ: ${input}`);
  }
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0));
}

interface TransitionRule {
  readonly month: number;
  readonly week: number;
  readonly day: number;
  readonly julian: boolean;
  readonly seconds: number;
}

function transitionRule(text: string, input: string): TransitionRule {
  const match = /^(?:M(\d{1,2})\.(\d)\.(\d)|(J?)(\d{1,3}))(?:\/(.+))?$/.exec(text);
  if (!match) throw new CommandFailure(`unsupported virtual TZ: ${input}`);
  const month = Number(match[1] ?? 0), week = Number(match[2] ?? 0);
  const day = Number(match[3] ?? match[5]), julian = match[4] === "J";
  if (match[1] !== undefined ? month < 1 || month > 12 || week < 1 || week > 5 || day > 6
    : day < (julian ? 1 : 0) || day > 365) throw new CommandFailure(`unsupported virtual TZ: ${input}`);
  return { month, week, day, julian, seconds: posixSeconds(match[6] ?? "2", 167, input) };
}

function transitionMilliseconds(rule: TransitionRule, year: number, offset: number): number {
  let day = rule.day;
  if (rule.month) {
    const first = utcMilliseconds({ year, month: rule.month, day: 1, hour: 0, minute: 0, second: 0 });
    day = 1 + (rule.day - new Date(first).getUTCDay() + 7) % 7 + (rule.week - 1) * 7;
    const last = utcFields(utcMilliseconds({ year, month: rule.month + 1, day: 0, hour: 0, minute: 0, second: 0 })).day;
    if (day > last) day -= 7;
  } else if (rule.julian) {
    if (day >= 60 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) day++;
  } else day++;
  return utcMilliseconds({ year, month: rule.month || 1, day, hour: 0, minute: 0, second: 0 })
    + (rule.seconds - offset) * 1000;
}

export class TimeZone {
  private readonly fixedOffset: number | undefined;
  private readonly formatter: Intl.DateTimeFormat | undefined;
  private readonly label: string;
  private readonly ianaZone: moment.MomentZone | null | undefined;
  private readonly daylight: { standardOffset: number; offset: number; label: string; start: TransitionRule; end: TransitionRule } | undefined;

  constructor(input: string, numericOffset = false) {
    const name = input.startsWith(":") ? input.slice(1) : input;
    this.label = name.startsWith("GMT") || name === "Etc/GMT" ? "GMT" : "UTC";
    if (numericOffset) this.fixedOffset = signedOffset(name);
    else if (["", "UTC", "UTC0", "GMT", "GMT0", "Etc/UTC", "Etc/GMT", "Z"].includes(name)) this.fixedOffset = 0;
    else if (name.includes(",")) {
      const seasonal = /^([A-Za-z]{3,}|<[A-Za-z0-9+-]{3,}>)([+-]?\d{1,2}(?::\d{1,2}){0,2})([A-Za-z]{3,}|<[A-Za-z0-9+-]{3,}>)([+-]?\d{1,2}(?::\d{1,2}){0,2})?,([^,]+),([^,]+)$/.exec(name);
      if (!seasonal) throw new CommandFailure(`unsupported virtual TZ: ${input}`);
      this.label = seasonal[1]!.startsWith("<") ? seasonal[1]!.slice(1, -1) : seasonal[1]!;
      const standardOffset = -posixSeconds(seasonal[2]!, 24, input);
      this.daylight = { standardOffset, offset: seasonal[4] === undefined ? standardOffset + 3600 : -posixSeconds(seasonal[4], 24, input),
        label: seasonal[3]!.startsWith("<") ? seasonal[3]!.slice(1, -1) : seasonal[3]!,
        start: transitionRule(seasonal[5]!, input), end: transitionRule(seasonal[6]!, input) };
    }
    else {
      const fixed = /^([A-Za-z]{3,}|<[A-Za-z0-9+-]{3,}>)([+-]?)(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?$/.exec(name);
      if (fixed) {
        this.label = fixed[1]!.startsWith("<") ? fixed[1]!.slice(1, -1) : fixed[1]!;
        this.fixedOffset = -signedOffset(`${fixed[2] || "+"}${fixed[3]!.padStart(2, "0")}:${fixed[4] ?? "00"}:${fixed[5] ?? "00"}`);
      }
      else {
        if (!/^[A-Za-z_+-][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/.test(name)) throw new CommandFailure(`unsupported virtual TZ: ${input}`);
        try {
          this.formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", { timeZone: name,
            year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
            era: "short", hourCycle: "h23", timeZoneName: "short" });
          this.ianaZone = moment.tz.zone(name) ?? moment.tz.zone(this.formatter.resolvedOptions().timeZone);
        } catch { throw new CommandFailure(`unsupported virtual TZ: ${input}`); }
      }
    }
  }

  fields(instant: bigint): ZonedFields {
    return this.observedFields(instant, true);
  }

  private observedFields(instant: bigint, restrictYear: boolean): ZonedFields {
    boundedInstant(instant);
    const seconds = floorDivide(instant, nanosecondsPerSecond);
    const milliseconds = Number(seconds * 1000n);
    let fields: CalendarFields, offset: number, zone: string;
    if (this.fixedOffset !== undefined) {
      fields = utcFields(milliseconds + this.fixedOffset * 1000);
      offset = this.fixedOffset;
      zone = this.label;
    } else if (this.daylight) {
      offset = this.daylight.standardOffset;
      zone = this.label;
      let latest = -Infinity;
      const year = utcFields(milliseconds).year;
      // Adjacent years cover southern seasons and transition times outside their nominal day.
      for (const transitionYear of [year - 1, year, year + 1]) {
        const start = transitionMilliseconds(this.daylight.start, transitionYear, this.daylight.standardOffset);
        const end = transitionMilliseconds(this.daylight.end, transitionYear, this.daylight.offset);
        if (start <= milliseconds && start > latest) {
          latest = start;
          offset = this.daylight.offset;
          zone = this.daylight.label;
        }
        if (end <= milliseconds && end > latest) {
          latest = end;
          offset = this.daylight.standardOffset;
          zone = this.label;
        }
      }
      fields = utcFields(milliseconds + offset * 1000);
    } else {
      const parts = Object.fromEntries(this.formatter!.formatToParts(new Date(milliseconds)).map(part => [part.type, part.value]));
      const year = Number(parts.year);
      fields = { year: parts.era === "BC" ? 1 - year : year, month: Number(parts.month), day: Number(parts.day),
        hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
      offset = (utcMilliseconds(fields) - milliseconds) / 1000;
      // Intl short names are localized display labels, not tzdata abbreviations.
      zone = this.ianaZone?.abbr(milliseconds) ?? parts.timeZoneName!;
    }
    checkCalendar(fields, restrictYear);
    return { ...fields, offset, zone };
  }

  instant(fields: CalendarFields, fraction = 0n, gapHandling: "reject" | "compatible" = "reject"): bigint {
    checkCalendar(fields);
    const wall = utcMilliseconds(fields);
    if (this.fixedOffset !== undefined) return boundedInstant(BigInt(wall) * 1000000n - BigInt(this.fixedOffset) * nanosecondsPerSecond + fraction);
    const offsets = new Set<number>();
    for (const days of [-2, -1, 0, 1, 2]) offsets.add(this.observedFields(BigInt(wall + days * 86400000) * 1000000n, false).offset);
    const candidates: bigint[] = [];
    const shifted: bigint[] = [];
    for (const offset of offsets) {
      const candidate = BigInt(wall) * 1000000n - BigInt(offset) * nanosecondsPerSecond + fraction;
      shifted.push(candidate);
      if (sameFields(this.observedFields(candidate, false), fields)) candidates.push(candidate);
    }
    if (candidates.length) {
      // Repeated local times resolve to their first occurrence.
      return boundedInstant(candidates.reduce((left, right) => left < right ? left : right));
    }
    if (gapHandling === "compatible") {
      return boundedInstant(shifted.reduce((left, right) => left > right ? left : right));
    }
    throw new CommandFailure("nonexistent local time in virtual TZ");
  }
}

function decimalEpoch(text: string): bigint | undefined {
  const match = /^@([+-]?)(\d+)(?:[.,](\d+))?$/.exec(text);
  if (!match) return undefined;
  if (match[2]!.replace(/^0+/, "").length > 13) throw new CommandFailure("date is outside the supported range");
  const fraction = match[3] ?? "";
  const magnitude = BigInt(match[2]!) * nanosecondsPerSecond + BigInt(fraction.slice(0, 9).padEnd(9, "0"));
  return boundedInstant(match[1] === "-" ? -magnitude - (/[1-9]/.test(fraction.slice(9)) ? 1n : 0n) : magnitude);
}

const dateZoneOffsets: Readonly<Record<string, string>> = {
  Z: "+00", UT: "+00", UTC: "+00", GMT: "+00", WET: "+00", BST: "+01",
  WEST: "+01", CET: "+01", CEST: "+02", MET: "+01", MEST: "+02",
  EET: "+02", EEST: "+03", MSK: "+03", MSD: "+04",
  AST: "-04", ADT: "-03", NST: "-03:30", NDT: "-02:30",
  EST: "-05", EDT: "-04", CST: "-06", CDT: "-05",
  MST: "-07", MDT: "-06", PST: "-08", PDT: "-07",
  AKST: "-09", AKDT: "-08", HST: "-10", JST: "+09", KST: "+09",
  NZST: "+12", NZDT: "+13"
};

function parsedZone(text: string | undefined, fallback: TimeZone): TimeZone {
  if (text === undefined) return fallback;
  const name = text.toUpperCase();
  if (name.startsWith("+") || name.startsWith("-")) return new TimeZone(name, true);
  // Date-string corrections use east-positive offsets, unlike POSIX TZ values.
  const correction = /^(?:UTC|GMT)([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
  if (correction) return new TimeZone(`${correction[1]}${correction[2]!.padStart(2, "0")}:${correction[3] ?? "00"}`, true);
  const offset = dateZoneOffsets[name];
  if (offset === undefined) throw new CommandFailure(`unsupported date timezone: ${text}`);
  return new TimeZone(offset, true);
}

export function parseDate(text: string, zone: TimeZone, now: () => bigint): bigint {
  const value = text.trim();
  if (value === "") {
    const fields = zone.fields(now());
    return zone.instant({ ...fields, hour: 0, minute: 0, second: 0 }, 0n);
  }
  const epoch = decimalEpoch(value);
  if (epoch !== undefined) return epoch;
  const weekday = /^(?:(next|last|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i.exec(value);
  if (weekday) {
    const fields = zone.fields(now());
    const target = weekdayNames.findIndex(name => name.toLowerCase() === weekday[2]!.toLowerCase());
    let days = (target - new Date(utcMilliseconds(fields)).getUTCDay() + 7) % 7;
    if (weekday[1]?.toLowerCase() === "last") days -= 7;
    else if (weekday[1]?.toLowerCase() === "next" && days === 0) days = 7;
    return zone.instant(utcFields(utcMilliseconds({ ...fields, day: fields.day + days, hour: 0, minute: 0, second: 0 })));
  }
  const relative = /(?:^|\s|(?<=[a-z])(?=[+-]))(?:(?:([+-]?\s*\d+|next|last|this)\s*)?(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|fortnights?|months?|years?)|(now|today|yesterday|tomorrow))(?:\s+(ago))?(?=\s|[+-]|\d|$)/gi;
  let base: { instant: bigint; zone: TimeZone } | undefined;
  let end = 0;
  let years = 0n, months = 0n, days = 0n, seconds = 0n;
  for (const item of value.matchAll(relative)) {
    if (base === undefined) {
      const prefix = value.slice(0, item.index).trim();
      base = prefix === "" ? { instant: now(), zone } : parseAbsoluteDate(prefix, zone, now);
    } else if (value.slice(end, item.index).trim() !== "") {
      throw new CommandFailure(`unsupported or invalid date: ${value}`);
    }
    end = item.index + item[0].length;
    const keyword = item[3]?.toLowerCase();
    const ordinal = item[1]?.toLowerCase();
    const rawAmount = keyword ? (keyword === "yesterday" ? "-1" : keyword === "tomorrow" ? "1" : "0")
      : ordinal === "last" ? "-1" : ordinal === "this" ? "0" : ordinal === "next" || ordinal === undefined ? "1" : ordinal.replace(/\s+/g, "");
    if (rawAmount.replace(/^[+-]?0*/, "").length > 13) throw new CommandFailure("relative date is outside the supported range");
    const amount = BigInt(rawAmount) * (item[4] ? -1n : 1n);
    const unit = item[2]?.toLowerCase() ?? "day";
    if (unit.startsWith("year")) years += amount;
    else if (unit.startsWith("month")) months += amount;
    else if (unit.startsWith("day")) days += amount;
    else if (unit.startsWith("week")) days += amount * 7n;
    else if (unit.startsWith("fortnight")) days += amount * 14n;
    else seconds += amount * (unit.startsWith("h") ? 3600n : unit.startsWith("min") ? 60n : 1n);
  }
  if (base) {
    const suffix = value.slice(end).trim();
    if (suffix) {
      const time = /^(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?$/.exec(suffix);
      if (!time) throw new CommandFailure(`unsupported or invalid date: ${value}`);
      base.instant = base.zone.instant({ ...base.zone.fields(base.instant), hour: Number(time[1]),
        minute: Number(time[2]), second: Number(time[3] ?? 0) }, BigInt((time[4] ?? "").slice(0, 9).padEnd(9, "0")));
    }
    let instant = base.instant;
    if (years || months || days) {
      const fields = base.zone.fields(instant);
      // Normalize combined calendar offsets once, then apply elapsed time across DST.
      const normalized = utcFields(utcMilliseconds({ ...fields, year: fields.year + Number(years),
        month: fields.month + Number(months), day: fields.day + Number(days) }));
      instant = base.zone.instant(normalized, instant - floorDivide(instant, nanosecondsPerSecond) * nanosecondsPerSecond);
    }
    return boundedInstant(instant + seconds * nanosecondsPerSecond);
  }
  return parseAbsoluteDate(value, zone, now).instant;
}

function parseAbsoluteDate(value: string, zone: TimeZone, now: () => bigint): { instant: bigint; zone: TimeZone } {
  const epoch = decimalEpoch(value);
  if (epoch !== undefined) return { instant: epoch, zone };
  const monthFirst = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?=\s|$)(.*)$/.exec(value);
  const dayFirst = /^(\d{1,2})(?:\s+|-)([A-Za-z]+)(?:\s+|-)(\d{4})(?=\s|$)(.*)$/.exec(value);
  const defaultOutput = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+([A-Za-z]+)\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(?:(\S+)\s+)?(\d{4})$/i.exec(value);
  if (monthFirst || dayFirst || defaultOutput) {
    const monthText = (monthFirst?.[1] ?? dayFirst?.[2] ?? defaultOutput![2]!).toLowerCase();
    const month = monthNames.findIndex(name => name.toLowerCase() === monthText || name.slice(0, 3).toLowerCase() === monthText) + 1;
    const day = monthFirst?.[2] ?? dayFirst?.[1] ?? defaultOutput![3]!;
    const year = monthFirst?.[3] ?? dayFirst?.[3] ?? defaultOutput![6]!;
    const timeText = monthFirst?.[4] ?? dayFirst?.[4] ?? ` ${defaultOutput![4]} ${defaultOutput![5] ?? ""}`;
    const parsed = parseAbsoluteDate(`${year}-${month}-${day}${timeText}`, zone, now);
    if (defaultOutput && weekdayNames[new Date(utcMilliseconds(parsed.zone.fields(parsed.instant))).getUTCDay()]!.slice(0, 3).toLowerCase() !== defaultOutput[1]!.toLowerCase()) {
      throw new CommandFailure("weekday does not match calendar date");
    }
    return parsed;
  }
  const numeric = /^(\d{2}(?:\d{2})?-\d{1,2}-\d{1,2}|\d{4}\/\d{1,2}\/\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2}(?:\d{2})?|\d{8})(?=$|[A-Za-z+\s-])(?:[Tt ](?=\d))?/i.exec(value);
  const remainder = numeric ? value.slice(numeric[0].length).trim() : value.replace(/^today\s+/i, "");
  const time = /^(?:(\d{1,2})(?::(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(am|pm|a\.m\.|p\.m\.)?)?(?:\s*((?:UTC|GMT)[+-]\d{1,2}(?::\d{2})?|[A-Za-z]+|[+-]\d{2}(?::?\d{2})?(?::\d{2})?))?$/i.exec(remainder);
  if (time && (numeric || time[1] !== undefined)) {
    const sourceZone = parsedZone(time[6], zone);
    let year: number, month: number, day: number;
    if (numeric) {
      const date = numeric[1]!;
      const parts = date.includes("/") ? date.split("/") : date.includes("-") ? date.split("-")
        : [date.slice(0, 4), date.slice(4, 6), date.slice(6)];
      const [yearText, monthText, dayText] = date.includes("/") && parts[0]!.length < 4
        ? [parts[2]!, parts[0]!, parts[1]!] : [parts[0]!, parts[1]!, parts[2]!];
      // GNU date maps two-digit years to 1969–2068; four-digit years stay literal.
      year = Number(yearText) + (yearText.length === 2 ? (Number(yearText) <= 68 ? 2000 : 1900) : 0);
      month = Number(monthText);
      day = Number(dayText);
    } else ({ year, month, day } = sourceZone.fields(now()));
    let hour = Number(time[1] ?? 0);
    if (time[5]) {
      if (hour < 1 || hour > 12) throw new CommandFailure("invalid calendar date or time");
      hour = hour % 12 + (time[5].toLowerCase().startsWith("p") ? 12 : 0);
    }
    const fields: CalendarFields = { year, month, day, hour, minute: Number(time[2] ?? 0), second: Number(time[3] ?? 0) };
    return { instant: sourceZone.instant(fields, BigInt((time[4] ?? "").slice(0, 9).padEnd(9, "0"))), zone: sourceZone };
  }
  const rfc = /^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+((?:UTC|GMT)[+-]\d{1,2}(?::\d{2})?|[A-Za-z]+|[+-]\d{4})$/.exec(value);
  if (rfc) {
    const fields: CalendarFields = { year: Number(rfc[4]), month: monthNames.findIndex(name => name.startsWith(rfc[3]!)) + 1,
      day: Number(rfc[2]), hour: Number(rfc[5]), minute: Number(rfc[6]), second: Number(rfc[7]) };
    if (rfc[1] && !weekdayNames[new Date(utcMilliseconds(fields)).getUTCDay()]!.startsWith(rfc[1])) throw new CommandFailure("weekday does not match calendar date");
    const sourceZone = parsedZone(rfc[8], zone);
    return { instant: sourceZone.instant(fields), zone: sourceZone };
  }
  const named = /^(?<month>[A-Za-z]+)\s+(?<day>\d{1,2}),?\s+(?<year>\d{4})(?:\s+(?<hour>\d{1,2})(?::(?<minute>\d{2})(?::(?<second>\d{2}))?)?\s*(?<period>am|pm)?)?(?:\s+(?<zone>Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?(?::\d{2})?))?$/i.exec(value)?.groups
    ?? /^(?:(?<weekday>Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s+)?(?<day>\d{1,2})(?:\s+|-)(?<month>[A-Za-z]+)(?:\s+|-)(?<year>\d{4})(?:\s+(?<hour>\d{1,2})(?::(?<minute>\d{2})(?::(?<second>\d{2}))?)?\s*(?<period>am|pm)?)?(?:\s+(?<zone>Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?(?::\d{2})?))?$/i.exec(value)?.groups
    ?? /^(?<weekday>Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(?<month>[A-Za-z]+)\s+(?<day>\d{1,2})\s+(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})\s+(?<zone>Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?(?::\d{2})?)\s+(?<year>\d{4})$/i.exec(value)?.groups;
  if (named) {
    const month = monthNames.findIndex(name => name.toLowerCase() === named.month!.toLowerCase()
      || name.slice(0, 3).toLowerCase() === named.month!.toLowerCase()) + 1;
    let hour = Number(named.hour ?? 0);
    if (named.period) {
      if (hour < 1 || hour > 12) throw new CommandFailure("invalid calendar date or time");
      hour = hour % 12 + (named.period.toLowerCase() === "pm" ? 12 : 0);
    }
    const fields: CalendarFields = { year: Number(named.year), month, day: Number(named.day),
      hour, minute: Number(named.minute ?? 0), second: Number(named.second ?? 0) };
    if (named.weekday && weekdayNames[new Date(utcMilliseconds(fields)).getUTCDay()]!.slice(0, 3).toLowerCase() !== named.weekday.toLowerCase()) {
      throw new CommandFailure("weekday does not match calendar date");
    }
    const sourceZone = parsedZone(named.zone, zone);
    return { instant: sourceZone.instant(fields), zone: sourceZone };
  }
  throw new CommandFailure(`unsupported or invalid date: ${value}`);
}

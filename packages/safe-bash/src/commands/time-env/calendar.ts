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
  if ((restrictYear && (fields.year < 0 || fields.year > 9999)) || fields.month < 1 || fields.month > 12 || fields.day < 1 || fields.day > 31
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

export class TimeZone {
  private readonly fixedOffset: number | undefined;
  private readonly formatter: Intl.DateTimeFormat | undefined;
  private readonly label: string;

  constructor(input: string, numericOffset = false) {
    const name = input.startsWith(":") ? input.slice(1) : input;
    this.label = name.startsWith("GMT") || name === "Etc/GMT" ? "GMT" : "UTC";
    if (numericOffset) this.fixedOffset = signedOffset(name);
    else if (["", "UTC", "UTC0", "GMT", "GMT0", "Etc/UTC", "Etc/GMT", "Z"].includes(name)) this.fixedOffset = 0;
    else {
      const fixed = /^(UTC|GMT)([+-])(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?$/.exec(name);
      if (fixed) this.fixedOffset = -signedOffset(`${fixed[2]}${fixed[3]!.padStart(2, "0")}:${fixed[4] ?? "00"}:${fixed[5] ?? "00"}`);
      else {
        if (!/^[A-Za-z_+-][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/.test(name)) throw new CommandFailure(`unsupported virtual TZ: ${input}`);
        try {
          this.formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", { timeZone: name,
            year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
            era: "short", hourCycle: "h23", timeZoneName: "short" });
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
    } else {
      const parts = Object.fromEntries(this.formatter!.formatToParts(new Date(milliseconds)).map(part => [part.type, part.value]));
      const year = Number(parts.year);
      fields = { year: parts.era === "BC" ? 1 - year : year, month: Number(parts.month), day: Number(parts.day),
        hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
      offset = (utcMilliseconds(fields) - milliseconds) / 1000;
      zone = parts.timeZoneName!;
    }
    checkCalendar(fields, restrictYear);
    return { ...fields, offset, zone };
  }

  instant(fields: CalendarFields, fraction = 0n): bigint {
    checkCalendar(fields);
    const wall = utcMilliseconds(fields);
    if (this.fixedOffset !== undefined) return boundedInstant(BigInt(wall) * 1000000n - BigInt(this.fixedOffset) * nanosecondsPerSecond + fraction);
    const offsets = new Set<number>();
    for (const days of [-2, -1, 0, 1, 2]) offsets.add(this.observedFields(BigInt(wall + days * 86400000) * 1000000n, false).offset);
    const candidates: bigint[] = [];
    for (const offset of offsets) {
      const candidate = BigInt(wall) * 1000000n - BigInt(offset) * nanosecondsPerSecond + fraction;
      if (sameFields(this.observedFields(candidate, false), fields)) candidates.push(candidate);
    }
    if (candidates.length === 0) throw new CommandFailure("nonexistent local time in virtual TZ");
    if (candidates.length !== 1) throw new CommandFailure("ambiguous local time; specify an explicit UTC offset");
    return boundedInstant(candidates[0]!);
  }
}

function decimalEpoch(text: string): bigint | undefined {
  const match = /^@([+-]?)(\d+)(?:[.,](\d{1,9}))?$/.exec(text);
  if (!match) return undefined;
  if (match[2]!.replace(/^0+/, "").length > 13) throw new CommandFailure("date is outside the supported range");
  const magnitude = BigInt(match[2]!) * nanosecondsPerSecond + BigInt((match[3] ?? "").padEnd(9, "0"));
  return boundedInstant(match[1] === "-" ? -magnitude : magnitude);
}

function parsedZone(text: string | undefined, fallback: TimeZone): TimeZone {
  if (text === undefined) return fallback;
  return /^[+-]/.test(text) ? new TimeZone(text, true) : new TimeZone(text);
}

export function parseDate(text: string, zone: TimeZone, now: () => bigint): bigint {
  const value = text.trim();
  const epoch = decimalEpoch(value);
  if (epoch !== undefined) return epoch;
  if (value === "now") return now();
  if (["today", "yesterday", "tomorrow"].includes(value)) {
    const current = now();
    if (value === "today") return current;
    const fields = zone.fields(current);
    const changed = utcFields(utcMilliseconds(fields) + (value === "yesterday" ? -86400000 : 86400000));
    return zone.instant(changed, current - floorDivide(current, nanosecondsPerSecond) * nanosecondsPerSecond);
  }
  const relative = /^(?:now\s+)?([+-]?\d+)\s+(seconds?|minutes?|hours?)(?:\s+(ago))?$/.exec(value);
  if (relative) {
    if (relative[1]!.replace(/^[+-]?0*/, "").length > 13) throw new CommandFailure("relative date is outside the supported range");
    const scale = relative[2]!.startsWith("hour") ? 3600n : relative[2]!.startsWith("minute") ? 60n : 1n;
    const adjustment = BigInt(relative[1]!) * scale * nanosecondsPerSecond * (relative[3] ? -1n : 1n);
    return boundedInstant(now() + adjustment);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?(?:\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?(?::\d{2})?))?$/.exec(value);
  if (iso) {
    const fields: CalendarFields = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]), hour: Number(iso[4] ?? 0),
      minute: Number(iso[5] ?? 0), second: Number(iso[6] ?? 0) };
    return parsedZone(iso[8], zone).instant(fields, BigInt((iso[7] ?? "").padEnd(9, "0")));
  }
  const rfc = /^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(GMT|UTC|[+-]\d{4})$/.exec(value);
  if (rfc) {
    const fields: CalendarFields = { year: Number(rfc[4]), month: monthNames.findIndex(name => name.startsWith(rfc[3]!)) + 1,
      day: Number(rfc[2]), hour: Number(rfc[5]), minute: Number(rfc[6]), second: Number(rfc[7]) };
    if (rfc[1] && !weekdayNames[new Date(utcMilliseconds(fields)).getUTCDay()]!.startsWith(rfc[1])) throw new CommandFailure("weekday does not match calendar date");
    return parsedZone(rfc[8], zone).instant(fields);
  }
  throw new CommandFailure(`unsupported or invalid date: ${text}`);
}

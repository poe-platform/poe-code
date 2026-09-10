import { types } from "node:util";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { SandboxObject } from "./values.js";

export type TemporalZonedDateTimeFields = Readonly<{
  epochNanoseconds: bigint;
  timeZone: string;
  calendar: string;
}>;
type ZonedInput = Omit<TemporalZonedDateTimeFields, "calendar"> & { calendar?: string };
declare const temporalZonedDateTimeBrand: unique symbol;
export type SandboxTemporalZonedDateTime = SandboxObject & { readonly [temporalZonedDateTimeBrand]: true };
const dates = new WeakMap<object, TemporalZonedDateTimeFields>();
const nativeTemporal = Object.getOwnPropertyDescriptor(globalThis, "Temporal")?.value;
const NativeZonedDateTime = nativeTemporal !== null && typeof nativeTemporal === "object"
  ? Object.getOwnPropertyDescriptor(nativeTemporal, "ZonedDateTime")?.value as typeof Backend.ZonedDateTime | undefined
  : undefined;
const HostZonedDateTime = NativeZonedDateTime ?? Backend.ZonedDateTime;
const hostReaders = new Map([Backend.ZonedDateTime, HostZonedDateTime].map(constructor => [constructor.prototype, {
  epochNanoseconds: Object.getOwnPropertyDescriptor(constructor.prototype, "epochNanoseconds")!.get!,
  timeZone: Object.getOwnPropertyDescriptor(constructor.prototype, "timeZoneId")!.get!,
  calendar: Object.getOwnPropertyDescriptor(constructor.prototype, "calendarId")!.get!
}]));
const exportedDates = new WeakSet<object>();

export function createHostTemporalZonedDateTime(fields: TemporalZonedDateTimeFields): object {
  const value = new HostZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar);
  exportedDates.add(value);
  return value;
}

export function hostTemporalZonedDateTimeFields(value: unknown): TemporalZonedDateTimeFields | undefined {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  let readers = hostReaders.get(prototype);
  if (readers === undefined) {
    if (!exportedDates.has(value)) return undefined;
    if (prototype !== null) throw new TypeError("Custom host ZonedDateTime prototypes cannot be copied as data.");
    readers = hostReaders.get(HostZonedDateTime.prototype)!;
  }
  return Object.freeze(Object.assign(Object.create(null), {
    epochNanoseconds: Reflect.apply(readers.epochNanoseconds, value, []),
    timeZone: Reflect.apply(readers.timeZone, value, []),
    calendar: Reflect.apply(readers.calendar, value, [])
  })) as TemporalZonedDateTimeFields;
}

// Internal data allocation only. Guest coercion and observable evaluation order
// belong to public adapters; no input accessors or proxy traps are invoked here.
export function createSandboxTemporalZonedDateTime(input: ZonedInput): SandboxTemporalZonedDateTime {
  if (input === null || typeof input !== "object" || types.isProxy(input))
    throw new TypeError("ZonedDateTime fields must be an ordinary data record.");
  const epoch = Object.getOwnPropertyDescriptor(input, "epochNanoseconds");
  const zone = Object.getOwnPropertyDescriptor(input, "timeZone");
  const calendar = Object.getOwnPropertyDescriptor(input, "calendar");
  if (epoch === undefined || !("value" in epoch) || typeof epoch.value !== "bigint")
    throw new TypeError("ZonedDateTime epoch must be a BigInt data property.");
  if (zone === undefined || !("value" in zone) || typeof zone.value !== "string")
    throw new TypeError("ZonedDateTime time zone must be a string data property.");
  if (calendar !== undefined && (!("value" in calendar) || typeof calendar.value !== "string"))
    throw new TypeError("ZonedDateTime calendar must be a string data property.");
  // The constructor accepts identifiers, not the full time-zone-like string
  // grammar used by conversion methods. It also enforces the instant range.
  const validated = new Backend.ZonedDateTime(epoch.value, zone.value, calendar === undefined ? "iso8601" : calendar.value);
  const fields = Object.freeze(Object.assign(Object.create(null), {
    epochNanoseconds: validated.epochNanoseconds,
    timeZone: validated.timeZoneId,
    calendar: validated.calendarId
  })) as TemporalZonedDateTimeFields;
  const value: SandboxTemporalZonedDateTime = Object.create(null);
  dates.set(value, fields);
  return value;
}

export function isSandboxTemporalZonedDateTime(value: unknown): value is SandboxTemporalZonedDateTime {
  return typeof value === "object" && value !== null && dates.has(value);
}

export function temporalZonedDateTimeFields(value: unknown): TemporalZonedDateTimeFields {
  if (!isSandboxTemporalZonedDateTime(value)) throw new TypeError("Expected a Temporal ZonedDateTime receiver.");
  return dates.get(value)!;
}

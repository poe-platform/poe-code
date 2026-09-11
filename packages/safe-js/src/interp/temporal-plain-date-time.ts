import { types } from "node:util";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { SandboxObject } from "./values.js";

export const temporalPlainDateTimeNumericFields = Object.freeze([
  "isoYear", "isoMonth", "isoDay", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond"
] as const);
export type TemporalPlainDateTimeFields = Readonly<
  Record<typeof temporalPlainDateTimeNumericFields[number], number> & { calendar: string }
>;
type DateTimeInput = Pick<TemporalPlainDateTimeFields, "isoYear" | "isoMonth" | "isoDay"> & Partial<TemporalPlainDateTimeFields>;
declare const temporalPlainDateTimeBrand: unique symbol;
export type SandboxTemporalPlainDateTime = SandboxObject & { readonly [temporalPlainDateTimeBrand]: true };
const dateTimes = new WeakMap<object, TemporalPlainDateTimeFields>();
const nativeTemporal = Object.getOwnPropertyDescriptor(globalThis, "Temporal")?.value;
const NativePlainDateTime = nativeTemporal !== null && typeof nativeTemporal === "object"
  ? Object.getOwnPropertyDescriptor(nativeTemporal, "PlainDateTime")?.value as typeof Backend.PlainDateTime | undefined
  : undefined;
const HostPlainDateTime = NativePlainDateTime ?? Backend.PlainDateTime;
const hostReaders = new Map([Backend.PlainDateTime, HostPlainDateTime].map(constructor => [constructor.prototype, {
  iso: Object.getOwnPropertyDescriptor(constructor.prototype, "withCalendar")!.value as (calendar: string) => object,
  calendar: Object.getOwnPropertyDescriptor(constructor.prototype, "calendarId")!.get!,
  fields: ["year", "month", "day", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond"]
    .map(name => Object.getOwnPropertyDescriptor(constructor.prototype, name)!.get!)
}]));
const exportedDateTimes = new WeakSet<object>();

export function createHostTemporalPlainDateTime(fields: TemporalPlainDateTimeFields): object {
  const value = Reflect.construct(HostPlainDateTime, [
    ...temporalPlainDateTimeNumericFields.map(name => fields[name]), fields.calendar
  ]);
  exportedDateTimes.add(value);
  return value;
}

export function hostTemporalPlainDateTimeFields(value: unknown): TemporalPlainDateTimeFields | undefined {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  let readers = hostReaders.get(prototype);
  if (readers === undefined) {
    if (!exportedDateTimes.has(value)) return undefined;
    if (prototype !== null) throw new TypeError("Custom host PlainDateTime prototypes cannot be copied as data.");
    readers = hostReaders.get(HostPlainDateTime.prototype)!;
  }
  const iso = Reflect.apply(readers.iso, value, ["iso8601"]);
  return Object.freeze({
    ...Object.fromEntries(temporalPlainDateTimeNumericFields.map((name, index) =>
      [name, Reflect.apply(readers.fields[index]!, iso, [])])),
    calendar: Reflect.apply(readers.calendar, value, [])
  }) as TemporalPlainDateTimeFields;
}

// Internal allocation only: callers must perform guest coercion and overflow
// handling first. ISO fields remain independent of calendar-derived getters.
export function createSandboxTemporalPlainDateTime(input: DateTimeInput): SandboxTemporalPlainDateTime {
  if (input === null || typeof input !== "object" || types.isProxy(input))
    throw new TypeError("PlainDateTime fields must be an ordinary data record.");
  const fields = Object.create(null) as Record<typeof temporalPlainDateTimeNumericFields[number], number> & { calendar: string };
  for (const [index, name] of temporalPlainDateTimeNumericFields.entries()) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (descriptor !== undefined && !("value" in descriptor))
      throw new TypeError("PlainDateTime fields must be numeric data properties.");
    const value: unknown = descriptor === undefined ? (index < 3 ? undefined : 0) : descriptor.value;
    if (typeof value !== "number") throw new TypeError("PlainDateTime fields must be numbers.");
    if (!Number.isInteger(value)) throw new RangeError("PlainDateTime fields must be finite integers.");
    fields[name] = value === 0 ? 0 : value;
  }
  const calendar = Object.getOwnPropertyDescriptor(input, "calendar");
  if (calendar !== undefined && (!("value" in calendar) || typeof calendar.value !== "string"))
    throw new TypeError("PlainDateTime calendar must be a string data property.");
  const validated = new Backend.PlainDateTime(
    fields.isoYear, fields.isoMonth, fields.isoDay,
    fields.hour, fields.minute, fields.second, fields.millisecond, fields.microsecond, fields.nanosecond,
    calendar === undefined ? "iso8601" : calendar.value
  );
  fields.calendar = validated.calendarId;
  const value: SandboxTemporalPlainDateTime = Object.create(null);
  dateTimes.set(value, Object.freeze(fields));
  return value;
}

export function isSandboxTemporalPlainDateTime(value: unknown): value is SandboxTemporalPlainDateTime {
  return typeof value === "object" && value !== null && dateTimes.has(value);
}

export function temporalPlainDateTimeFields(value: unknown): TemporalPlainDateTimeFields {
  if (!isSandboxTemporalPlainDateTime(value)) throw new TypeError("Expected a Temporal PlainDateTime receiver.");
  return dateTimes.get(value)!;
}

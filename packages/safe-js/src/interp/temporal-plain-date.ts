import { types } from "node:util";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import type { SandboxObject } from "./values.js";

export const temporalPlainDateNumericFields = Object.freeze(["isoYear", "isoMonth", "isoDay"] as const);
export type TemporalPlainDateFields = Readonly<Record<typeof temporalPlainDateNumericFields[number], number> & { calendar: string }>;
type DateInput = Omit<TemporalPlainDateFields, "calendar"> & { calendar?: string };
declare const temporalPlainDateBrand: unique symbol;
export type SandboxTemporalPlainDate = SandboxObject & { readonly [temporalPlainDateBrand]: true };
const dates = new WeakMap<object, TemporalPlainDateFields>();
const nativeTemporal = Object.getOwnPropertyDescriptor(globalThis, "Temporal")?.value;
const NativePlainDate = nativeTemporal !== null && typeof nativeTemporal === "object"
  ? Object.getOwnPropertyDescriptor(nativeTemporal, "PlainDate")?.value as typeof Backend.PlainDate | undefined
  : undefined;
const HostPlainDate = NativePlainDate ?? Backend.PlainDate;
const hostReaders = new Map([Backend.PlainDate, HostPlainDate].map(constructor => [constructor.prototype, {
  iso: Object.getOwnPropertyDescriptor(constructor.prototype, "withCalendar")!.value as (calendar: string) => object,
  calendar: Object.getOwnPropertyDescriptor(constructor.prototype, "calendarId")!.get!,
  fields: ["year", "month", "day"].map(name => Object.getOwnPropertyDescriptor(constructor.prototype, name)!.get!)
}]));
const exportedDates = new WeakSet<object>();

export function createHostTemporalPlainDate(fields: TemporalPlainDateFields): object {
  const value = Reflect.construct(HostPlainDate, [fields.isoYear, fields.isoMonth, fields.isoDay, fields.calendar]);
  exportedDates.add(value);
  return value;
}

export function hostTemporalPlainDateFields(value: unknown): TemporalPlainDateFields | undefined {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  let readers = hostReaders.get(prototype);
  if (readers === undefined) {
    if (!exportedDates.has(value)) return undefined;
    if (prototype !== null) throw new TypeError("Custom host PlainDate prototypes cannot be copied as data.");
    readers = hostReaders.get(HostPlainDate.prototype)!;
  }
  const iso = Reflect.apply(readers.iso, value, ["iso8601"]);
  return Object.freeze({
    ...Object.fromEntries(temporalPlainDateNumericFields.map((name, index) =>
      [name, Reflect.apply(readers.fields[index]!, iso, [])])),
    calendar: Reflect.apply(readers.calendar, value, [])
  }) as TemporalPlainDateFields;
}

// Internal allocation: guest coercion and overflow handling belong to callers.
// ISO fields must not be reinterpreted as calendar-derived year/month values.
export function createSandboxTemporalPlainDate(input: DateInput): SandboxTemporalPlainDate {
  if (input === null || typeof input !== "object" || types.isProxy(input))
    throw new TypeError("PlainDate fields must be an ordinary data record.");
  const fields = Object.create(null) as Record<typeof temporalPlainDateNumericFields[number], number> & { calendar: string };
  for (const name of temporalPlainDateNumericFields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "number")
      throw new TypeError("PlainDate fields must be numeric data properties.");
    const value: number = descriptor.value;
    if (!Number.isInteger(value)) throw new RangeError("PlainDate fields must be finite integers.");
    fields[name] = value === 0 ? 0 : value;
  }
  const calendar = Object.getOwnPropertyDescriptor(input, "calendar");
  if (calendar !== undefined && (!("value" in calendar) || typeof calendar.value !== "string"))
    throw new TypeError("PlainDate calendar must be a string data property.");
  const validated = new Backend.PlainDate(fields.isoYear, fields.isoMonth, fields.isoDay,
    calendar === undefined ? "iso8601" : calendar.value);
  fields.calendar = validated.calendarId;
  const value: SandboxTemporalPlainDate = Object.create(null);
  dates.set(value, Object.freeze(fields));
  return value;
}

export function isSandboxTemporalPlainDate(value: unknown): value is SandboxTemporalPlainDate {
  return typeof value === "object" && value !== null && dates.has(value);
}

export function temporalPlainDateFields(value: unknown): TemporalPlainDateFields {
  if (!isSandboxTemporalPlainDate(value)) throw new TypeError("Expected a Temporal PlainDate receiver.");
  return dates.get(value)!;
}

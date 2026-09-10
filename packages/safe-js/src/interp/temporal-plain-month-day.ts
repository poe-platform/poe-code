import { types } from "node:util";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { hostTemporalPlainDateFields, temporalPlainDateNumericFields, type TemporalPlainDateFields } from "./temporal-plain-date.js";
import type { SandboxObject } from "./values.js";

export type TemporalPlainMonthDayFields = TemporalPlainDateFields;
type MonthDayInput = Omit<TemporalPlainMonthDayFields, "calendar"> & { calendar?: string };
declare const temporalPlainMonthDayBrand: unique symbol;
export type SandboxTemporalPlainMonthDay = SandboxObject & { readonly [temporalPlainMonthDayBrand]: true };
const monthDays = new WeakMap<object, TemporalPlainMonthDayFields>();
const nativeTemporal = Object.getOwnPropertyDescriptor(globalThis, "Temporal")?.value;
const NativePlainMonthDay = nativeTemporal !== null && typeof nativeTemporal === "object"
  ? Object.getOwnPropertyDescriptor(nativeTemporal, "PlainMonthDay")?.value as typeof Backend.PlainMonthDay | undefined
  : undefined;
const HostPlainMonthDay = NativePlainMonthDay ?? Backend.PlainMonthDay;
const hostFormatters = new Map([Backend.PlainMonthDay, HostPlainMonthDay].map(constructor =>
  [constructor.prototype, Object.getOwnPropertyDescriptor(constructor.prototype, "toString")!.value as (options: { calendarName: "always" }) => string]));
const dateFrom = Backend.PlainDate.from;
const exportedMonthDays = new WeakSet<object>();

export function createHostTemporalPlainMonthDay(fields: TemporalPlainMonthDayFields): object {
  const value = Reflect.construct(HostPlainMonthDay, [fields.isoMonth, fields.isoDay, fields.calendar, fields.isoYear]);
  exportedMonthDays.add(value);
  return value;
}

export function hostTemporalPlainMonthDayFields(value: unknown): TemporalPlainMonthDayFields | undefined {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  let format = hostFormatters.get(prototype);
  if (format === undefined) {
    if (!exportedMonthDays.has(value)) return undefined;
    if (prototype !== null) throw new TypeError("Custom host PlainMonthDay prototypes cannot be copied as data.");
    format = hostFormatters.get(HostPlainMonthDay.prototype)!;
  }
  // PlainMonthDay has no reference-year getter. The captured intrinsic's
  // calendarName=always representation includes its exact private ISO date.
  const text = Reflect.apply(format, value, [{ calendarName: "always" }]);
  return hostTemporalPlainDateFields(Reflect.apply(dateFrom, Backend.PlainDate, [text]));
}

// Internal allocation only: guest coercion and reference-year defaults belong
// to public callers. All three ISO fields are required own primitive data.
export function createSandboxTemporalPlainMonthDay(input: MonthDayInput): SandboxTemporalPlainMonthDay {
  if (input === null || typeof input !== "object" || types.isProxy(input))
    throw new TypeError("PlainMonthDay fields must be an ordinary data record.");
  const fields = Object.create(null) as Record<typeof temporalPlainDateNumericFields[number], number> & { calendar: string };
  for (const name of temporalPlainDateNumericFields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "number")
      throw new TypeError("PlainMonthDay fields must be numeric data properties.");
    const value: number = descriptor.value;
    if (!Number.isInteger(value)) throw new RangeError("PlainMonthDay fields must be finite integers.");
    fields[name] = value === 0 ? 0 : value;
  }
  const calendar = Object.getOwnPropertyDescriptor(input, "calendar");
  if (calendar !== undefined && (!("value" in calendar) || typeof calendar.value !== "string"))
    throw new TypeError("PlainMonthDay calendar must be a string data property.");
  const validated = new Backend.PlainMonthDay(fields.isoMonth, fields.isoDay,
    calendar === undefined ? "iso8601" : calendar.value, fields.isoYear);
  fields.calendar = validated.calendarId;
  const value: SandboxTemporalPlainMonthDay = Object.create(null);
  monthDays.set(value, Object.freeze(fields));
  return value;
}

export function isSandboxTemporalPlainMonthDay(value: unknown): value is SandboxTemporalPlainMonthDay {
  return typeof value === "object" && value !== null && monthDays.has(value);
}

export function temporalPlainMonthDayFields(value: unknown): TemporalPlainMonthDayFields {
  if (!isSandboxTemporalPlainMonthDay(value)) throw new TypeError("Expected a Temporal PlainMonthDay receiver.");
  return monthDays.get(value)!;
}

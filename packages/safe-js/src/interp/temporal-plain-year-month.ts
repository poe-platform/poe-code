import { types } from "node:util";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { temporalPlainDateNumericFields, type TemporalPlainDateFields } from "./temporal-plain-date.js";
import type { SandboxObject } from "./values.js";

export type TemporalPlainYearMonthFields = TemporalPlainDateFields;
type YearMonthInput = Omit<TemporalPlainYearMonthFields, "calendar"> & { calendar?: string };
declare const temporalPlainYearMonthBrand: unique symbol;
export type SandboxTemporalPlainYearMonth = SandboxObject & { readonly [temporalPlainYearMonthBrand]: true };
const yearMonths = new WeakMap<object, TemporalPlainYearMonthFields>();
const nativeTemporal = Object.getOwnPropertyDescriptor(globalThis, "Temporal")?.value;
const NativePlainYearMonth = nativeTemporal !== null && typeof nativeTemporal === "object"
  ? Object.getOwnPropertyDescriptor(nativeTemporal, "PlainYearMonth")?.value as typeof Backend.PlainYearMonth | undefined
  : undefined;
const HostPlainYearMonth = NativePlainYearMonth ?? Backend.PlainYearMonth;
const hostReaders = new Map([Backend.PlainYearMonth, HostPlainYearMonth].map(constructor => [constructor.prototype, {
  format: Object.getOwnPropertyDescriptor(constructor.prototype, "toString")!.value as (options: { calendarName: "always" }) => string,
  calendar: Object.getOwnPropertyDescriptor(constructor.prototype, "calendarId")!.get!
}]));
const exportedYearMonths = new WeakSet<object>();

export function createHostTemporalPlainYearMonth(fields: TemporalPlainYearMonthFields): object {
  const value = Reflect.construct(HostPlainYearMonth, [fields.isoYear, fields.isoMonth, fields.calendar, fields.isoDay]);
  exportedYearMonths.add(value);
  return value;
}

export function hostTemporalPlainYearMonthFields(value: unknown): TemporalPlainYearMonthFields | undefined {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  let readers = hostReaders.get(prototype);
  if (readers === undefined) {
    if (!exportedYearMonths.has(value)) return undefined;
    if (prototype !== null) throw new TypeError("Custom host PlainYearMonth prototypes cannot be copied as data.");
    readers = hostReaders.get(HostPlainYearMonth.prototype)!;
  }
  // The captured intrinsic's always form includes the reference ISO day. A
  // PlainDate parser cannot be used: year-month boundary months allow reference
  // dates outside the narrower PlainDate range. This is canonical intrinsic
  // output, not user-supplied date text requiring a general-purpose parser.
  const text = Reflect.apply(readers.format, value, [{ calendarName: "always" }]);
  const yearEnd = text[0] === "+" || text[0] === "-" ? 7 : 4;
  return {
    isoYear: Number(text.slice(0, yearEnd)),
    isoMonth: Number(text.slice(yearEnd + 1, yearEnd + 3)),
    isoDay: Number(text.slice(yearEnd + 4, yearEnd + 6)),
    calendar: Reflect.apply(readers.calendar, value, [])
  };
}

export function createSandboxTemporalPlainYearMonth(input: YearMonthInput): SandboxTemporalPlainYearMonth {
  if (input === null || typeof input !== "object" || types.isProxy(input))
    throw new TypeError("PlainYearMonth fields must be an ordinary data record.");
  const fields = Object.create(null) as Record<typeof temporalPlainDateNumericFields[number], number> & { calendar: string };
  for (const name of temporalPlainDateNumericFields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "number")
      throw new TypeError("PlainYearMonth fields must be numeric data properties.");
    const value: number = descriptor.value;
    if (!Number.isInteger(value)) throw new RangeError("PlainYearMonth fields must be finite integers.");
    fields[name] = value === 0 ? 0 : value;
  }
  const calendar = Object.getOwnPropertyDescriptor(input, "calendar");
  if (calendar !== undefined && (!("value" in calendar) || typeof calendar.value !== "string"))
    throw new TypeError("PlainYearMonth calendar must be a string data property.");
  const validated = new Backend.PlainYearMonth(fields.isoYear, fields.isoMonth,
    calendar === undefined ? "iso8601" : calendar.value, fields.isoDay);
  fields.calendar = validated.calendarId;
  const value: SandboxTemporalPlainYearMonth = Object.create(null);
  yearMonths.set(value, Object.freeze(fields));
  return value;
}

export function isSandboxTemporalPlainYearMonth(value: unknown): value is SandboxTemporalPlainYearMonth {
  return typeof value === "object" && value !== null && yearMonths.has(value);
}

export function temporalPlainYearMonthFields(value: unknown): TemporalPlainYearMonthFields {
  if (!isSandboxTemporalPlainYearMonth(value)) throw new TypeError("Expected a Temporal PlainYearMonth receiver.");
  return yearMonths.get(value)!;
}

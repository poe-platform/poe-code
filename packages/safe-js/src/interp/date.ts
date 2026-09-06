import { types } from "node:util";
import type { Budget } from "./budget.js";

const NativeDate = Date;
const readTime = NativeDate.prototype.getTime;
const writeTime = NativeDate.prototype.setTime;
const dates = new WeakSet<object>();

export function isSandboxDate(value: unknown): value is Date {
  return typeof value === "object" && value !== null && dates.has(value);
}

export function createSandboxDate(time: number): Date {
  const value = new NativeDate(time);
  dates.add(value);
  return value;
}

export function dateTime(value: Date): number {
  return Reflect.apply(readTime, value, []);
}

export function copyNativeDate(value: unknown): Date | undefined {
  if (!types.isDate(value)) return undefined;
  if (Object.getPrototypeOf(value) !== NativeDate.prototype)
    throw new TypeError("Date subclasses are not supported.");
  return createSandboxDate(dateTime(value));
}

export function exportDate(value: Date): Date {
  return new NativeDate(dateTime(value));
}

export function dateDataProperties(value: Date): Array<[string | symbol, PropertyDescriptor]> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)!.value as PropertyDescriptor;
    if (!("value" in descriptor)) throw new TypeError("Date accessor properties cannot be copied as data.");
    return [key, descriptor];
  });
}

export function dateNumber(value: unknown): number {
  if (isSandboxDate(value)) return dateTime(value);
  if (
    (typeof value === "object" && value !== null) ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  )
    throw new TypeError("Date arguments require primitive values; custom coercion is unsupported.");
  return Number(value);
}

export function parseDate(value: unknown, budget: Budget): number {
  if ((typeof value === "object" && value !== null) || typeof value === "function")
    throw new TypeError("Date parsing requires a primitive value.");
  const text = String(value);
  if (text.length > 4096) throw new RangeError("Date input exceeds the 4096 character limit.");
  budget.allocateString(text);
  for (let index = 0; index < text.length; index++) budget.visitNode();
  return NativeDate.parse(text);
}

export function dateFromParts(args: readonly unknown[], utc: boolean): number {
  const parts = args.slice(0, 7).map(dateNumber);
  return utc
    ? Reflect.apply(NativeDate.UTC, NativeDate, parts)
    : dateTime(Reflect.construct(NativeDate, parts));
}

const methodNames = [
  "getTime",
  "valueOf",
  "getDate",
  "getDay",
  "getFullYear",
  "getYear",
  "getHours",
  "getMilliseconds",
  "getMinutes",
  "getMonth",
  "getSeconds",
  "getTimezoneOffset",
  "getUTCDate",
  "getUTCDay",
  "getUTCFullYear",
  "getUTCHours",
  "getUTCMilliseconds",
  "getUTCMinutes",
  "getUTCMonth",
  "getUTCSeconds",
  "setTime",
  "setDate",
  "setFullYear",
  "setYear",
  "setHours",
  "setMilliseconds",
  "setMinutes",
  "setMonth",
  "setSeconds",
  "setUTCDate",
  "setUTCFullYear",
  "setUTCHours",
  "setUTCMilliseconds",
  "setUTCMinutes",
  "setUTCMonth",
  "setUTCSeconds",
  "toDateString",
  "toISOString",
  "toString",
  "toTimeString",
  "toUTCString",
  "toJSON"
] as const;
export type DateMethod = (typeof methodNames)[number];
export const dateMethods = new Map<
  string,
  { length: number; invoke: (date: Date, args: readonly unknown[]) => unknown }
>(
  methodNames.map((name) => {
    const native = Object.getOwnPropertyDescriptor(NativeDate.prototype, name)!.value as
      (...args: number[]) => number | string | null;
    return [
      name,
      {
        length: native.length,
        invoke: (date, args) => {
          if (name === "toJSON")
            return Number.isNaN(dateTime(date))
              ? null
              : Reflect.apply(NativeDate.prototype.toISOString, date, []);
          return Reflect.apply(
            native,
            date,
            name.startsWith("set") ? args.slice(0, native.length).map(dateNumber) : []
          );
        }
      }
    ];
  })
);

export function dateString(value: Date): string {
  return dateMethods.get("toString")!.invoke(value, []) as string;
}

export function restoreDateTime(value: unknown): Date {
  if (
    value !== null &&
    (typeof value !== "number" ||
      !Number.isInteger(value) ||
      Math.abs(value) > 8.64e15 ||
      Object.is(value, -0))
  )
    throw new TypeError("Invalid serialized Date epoch.");
  const date = createSandboxDate(0);
  Reflect.apply(writeTime, date, [value === null ? NaN : value]);
  return date;
}

export function serializedDateTime(value: Date): number | null {
  const time = dateTime(value);
  return Number.isNaN(time) ? null : time;
}

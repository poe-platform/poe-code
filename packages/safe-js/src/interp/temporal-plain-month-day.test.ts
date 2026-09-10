import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import {
  createSandboxTemporalPlainMonthDay, temporalPlainMonthDayFields,
  isSandboxTemporalPlainMonthDay, createHostTemporalPlainMonthDay,
  hostTemporalPlainMonthDayFields
} from "./temporal-plain-month-day.js";

it("copies and freezes private ISO reference fields without public properties", () => {
  const input = { isoYear: 2000, isoMonth: 2, isoDay: 29, calendar: "BUDDHIST" };
  const value = createSandboxTemporalPlainMonthDay(input);
  input.isoYear = 2004;
  expect(Object.getPrototypeOf(value)).toBeNull();
  expect(Object.isExtensible(value)).toBe(true);
  expect(Reflect.ownKeys(value)).toEqual([]);
  for (const key of ["year", "monthCode", "day", "calendarId", "toString"])
    Object.defineProperty(value, key, { get() { throw Error("public read"); } });
  const fields = temporalPlainMonthDayFields(value);
  expect(fields).toEqual({ isoYear: 2000, isoMonth: 2, isoDay: 29, calendar: "buddhist" });
  expect(Object.isFrozen(fields)).toBe(true);
  expect(Object.getPrototypeOf(fields)).toBeNull();
});

it.each([[-271821, 4, 19], [275760, 9, 13], [1972, 2, 29], [0, 1, 1]])(
  "retains reference date %s-%s-%s", (isoYear, isoMonth, isoDay) => {
    const fields = { isoYear, isoMonth, isoDay, calendar: "iso8601" };
    expect(temporalPlainMonthDayFields(createSandboxTemporalPlainMonthDay(fields))).toEqual(fields);
    expect(hostTemporalPlainMonthDayFields(createHostTemporalPlainMonthDay(fields))).toEqual(fields);
  }
);

it.each([[-271821, 4, 18], [275760, 9, 14], [2001, 2, 29], [1972, 13, 1],
  [1972, 1, 0], [Infinity, 1, 1], [1972, 1.5, 1], [NaN, 1, 1]])(
  "rejects invalid ISO reference date %s-%s-%s", (isoYear, isoMonth, isoDay) => {
    expect(() => createSandboxTemporalPlainMonthDay({ isoYear, isoMonth, isoDay })).toThrow(RangeError);
  }
);

it("does not invoke getters, coercion or proxy traps on internal input", () => {
  const input = { isoYear: 1972, isoMonth: 2, isoDay: 29, calendar: "iso8601" };
  let reads = 0;
  const bad = [null, Object.create(input), new Proxy(input, { getOwnPropertyDescriptor() { reads++; throw Error("trap"); } })];
  for (const key of Object.keys(input)) {
    bad.push(Object.defineProperty({ ...input }, key, { get() { reads++; return 1; } }));
    bad.push({ ...input, [key]: { valueOf() { reads++; return 1; }, toString() { reads++; return "iso8601"; } } });
  }
  for (const value of bad) expect(() => createSandboxTemporalPlainMonthDay(value as never)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it("rejects forged and proxy-wrapped receivers", () => {
  const value = createSandboxTemporalPlainMonthDay({ isoYear: 1972, isoMonth: 2, isoDay: 29 });
  expect(isSandboxTemporalPlainMonthDay(value)).toBe(true);
  for (const other of [null, undefined, {}, Object.create(value), new Proxy(value, { getPrototypeOf() { throw Error("trap"); } })]) {
    expect(isSandboxTemporalPlainMonthDay(other)).toBe(false);
    expect(() => temporalPlainMonthDayFields(other)).toThrow(TypeError);
  }
});

it("reads captured host slots without public formatting or calendar getters", () => {
  const value = new Backend.PlainMonthDay(2, 29, "buddhist", 2000);
  for (const key of ["toString", "calendarId", "monthCode", "day"])
    Object.defineProperty(value, key, { get() { throw Error("public read"); } });
  expect(hostTemporalPlainMonthDayFields(value)).toEqual({ isoYear: 2000, isoMonth: 2, isoDay: 29, calendar: "buddhist" });
  expect(hostTemporalPlainMonthDayFields(new Proxy(value, {}))).toBeUndefined();
  expect(() => hostTemporalPlainMonthDayFields(Object.create(Backend.PlainMonthDay.prototype))).toThrow(TypeError);
});

it("recognizes tracked null-prototype exports but rejects custom prototypes", () => {
  const fields = { isoYear: 2000, isoMonth: 2, isoDay: 29, calendar: "buddhist" };
  const value = createHostTemporalPlainMonthDay(fields);
  Object.setPrototypeOf(value, null);
  expect(hostTemporalPlainMonthDayFields(value)).toEqual(fields);
  Object.setPrototypeOf(value, {});
  expect(() => hostTemporalPlainMonthDayFields(value)).toThrow(TypeError);
  const untracked = new Backend.PlainMonthDay(2, 29);
  Object.setPrototypeOf(untracked, null);
  expect(hostTemporalPlainMonthDayFields(untracked)).toBeUndefined();
});

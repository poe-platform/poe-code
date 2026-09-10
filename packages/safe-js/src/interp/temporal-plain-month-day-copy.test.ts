import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { cloneSandboxValue, deepCopyFromSandbox, deepCopyToSandbox, measureSandboxData } from "./values.js";
import { createSandboxTemporalPlainMonthDay, temporalPlainMonthDayFields } from "./temporal-plain-month-day.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "./object-model.js";

const fields = { isoYear: 2000, isoMonth: 2, isoDay: 29, calendar: "buddhist" };

it("clones private reference dates with aliases, symbols and frozen cycles", () => {
  const value = createSandboxTemporalPlainMonthDay(fields), key = Symbol("label");
  Object.defineProperty(value, "self", { value });
  Object.defineProperty(value, key, { value: 7 });
  Object.freeze(value);
  const copy = cloneSandboxValue([value, value]);
  if (!Array.isArray(copy)) throw Error("Expected array");
  expect(copy[0]).not.toBe(value);
  expect(copy[0]).toBe(copy[1]);
  expect(temporalPlainMonthDayFields(copy[0])).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy[0], "self")?.value).toBe(copy[0]);
  expect(Object.getOwnPropertyDescriptor(copy[0], key)?.value).toBe(7);
  expect(Object.isFrozen(copy[0])).toBe(true);
});

it("imports exact reference dates while preserving own public shadows", () => {
  const value = new Backend.PlainMonthDay(2, 29, "buddhist", 2000);
  Object.defineProperty(value, "day", { value: 7 });
  const copy = deepCopyToSandbox(value);
  expect(temporalPlainMonthDayFields(copy)).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy, "day")?.value).toBe(7);
});

it("round-trips exported private slots and explicit null prototypes", () => {
  for (const nullPrototype of [false, true]) {
    const value = createSandboxTemporalPlainMonthDay(fields);
    if (nullPrototype) setSandboxPrototype(value, null);
    const host = deepCopyFromSandbox(value);
    if (nullPrototype) expect(Object.getPrototypeOf(host)).toBeNull();
    const copy = deepCopyToSandbox(host);
    expect(temporalPlainMonthDayFields(copy)).toEqual(fields);
    expect(hasNullObjectPrototype(copy as object)).toBe(nullPrototype);
  }
});

it("charges the private reference year, month, day and calendar", () => {
  expect(measureSandboxData([createSandboxTemporalPlainMonthDay(fields)]) - measureSandboxData([Object.create(null)]))
    .toBe(3 * 8 + fields.calendar.length);
});

it("rejects structuredClone instead of silently discarding private slots", () => {
  expect(() => cloneSandboxValue(createSandboxTemporalPlainMonthDay(fields), { structuredClone: true }))
    .toThrow(expect.objectContaining({ name: "DataCloneError" }));
});

it.each(["import", "export", "clone"] as const)("rejects accessors without invoking them during %s", direction => {
  const value = direction === "import" ? new Backend.PlainMonthDay(2, 29) : createSandboxTemporalPlainMonthDay(fields);
  let reads = 0;
  Object.defineProperty(value, "label", { get() { reads++; return 1; } });
  const copy = direction === "import" ? deepCopyToSandbox : direction === "export" ? deepCopyFromSandbox : cloneSandboxValue;
  expect(() => copy(value as never)).toThrow(TypeError);
  expect(reads).toBe(0);
});

import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { cloneSandboxValue, deepCopyFromSandbox, deepCopyToSandbox, measureSandboxData } from "./values.js";
import { createSandboxTemporalPlainYearMonth, temporalPlainYearMonthFields } from "./temporal-plain-year-month.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "./object-model.js";

const fields = { isoYear: 2000, isoMonth: 2, isoDay: 29, calendar: "buddhist" };

it("clones private reference dates with aliases, symbols and frozen cycles", () => {
  const value = createSandboxTemporalPlainYearMonth(fields), key = Symbol("label");
  Object.defineProperty(value, "self", { value });
  Object.defineProperty(value, key, { value: 7 });
  Object.freeze(value);
  const copy = cloneSandboxValue([value, value]);
  if (!Array.isArray(copy)) throw Error("Expected array");
  expect(copy[0]).not.toBe(value);
  expect(copy[0]).toBe(copy[1]);
  expect(temporalPlainYearMonthFields(copy[0])).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy[0], "self")?.value).toBe(copy[0]);
  expect(Object.getOwnPropertyDescriptor(copy[0], key)?.value).toBe(7);
  expect(Object.isFrozen(copy[0])).toBe(true);
});

it("imports exact reference dates while preserving own public shadows", () => {
  const value = new Backend.PlainYearMonth(2000, 2, "buddhist", 29);
  Object.defineProperty(value, "day", { value: 7 });
  const copy = deepCopyToSandbox(value);
  expect(temporalPlainYearMonthFields(copy)).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy, "day")?.value).toBe(7);
});

it("round-trips exported private slots and explicit null prototypes", () => {
  for (const nullPrototype of [false, true]) {
    const value = createSandboxTemporalPlainYearMonth(fields);
    if (nullPrototype) setSandboxPrototype(value, null);
    const host = deepCopyFromSandbox(value);
    if (nullPrototype) expect(Object.getPrototypeOf(host)).toBeNull();
    const copy = deepCopyToSandbox(host);
    expect(temporalPlainYearMonthFields(copy)).toEqual(fields);
    expect(hasNullObjectPrototype(copy as object)).toBe(nullPrototype);
  }
});

it("charges the private reference year, month, day and calendar", () => {
  expect(measureSandboxData([createSandboxTemporalPlainYearMonth(fields)]) - measureSandboxData([Object.create(null)]))
    .toBe(3 * 8 + fields.calendar.length);
});

it("rejects structuredClone instead of silently discarding private slots", () => {
  expect(() => cloneSandboxValue(createSandboxTemporalPlainYearMonth(fields), { structuredClone: true }))
    .toThrow(expect.objectContaining({ name: "DataCloneError" }));
});

it.each(["import", "export", "clone"] as const)("rejects accessors without invoking them during %s", direction => {
  const value = direction === "import" ? new Backend.PlainYearMonth(2000, 2) : createSandboxTemporalPlainYearMonth(fields);
  let reads = 0;
  Object.defineProperty(value, "label", { get() { reads++; return 1; } });
  const copy = direction === "import" ? deepCopyToSandbox : direction === "export" ? deepCopyFromSandbox : cloneSandboxValue;
  expect(() => copy(value as never)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it.each([
  { isoYear: -271821, isoMonth: 4, isoDay: 1, calendar: "iso8601" },
  { isoYear: 275760, isoMonth: 9, isoDay: 30, calendar: "iso8601" }
])("copies year-month boundary dates outside PlainDate limits: %j", boundary => {
  const value = createSandboxTemporalPlainYearMonth(boundary);
  expect(temporalPlainYearMonthFields(cloneSandboxValue(value))).toEqual(boundary);
  expect(temporalPlainYearMonthFields(deepCopyToSandbox(deepCopyFromSandbox(value)))).toEqual(boundary);
});

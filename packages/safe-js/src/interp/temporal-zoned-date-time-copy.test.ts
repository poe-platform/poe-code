import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { cloneSandboxValue, deepCopyFromSandbox, deepCopyToSandbox, measureSandboxData } from "./values.js";
import { createSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "./temporal-zoned-date-time.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "./object-model.js";

const fields = { epochNanoseconds: 123456789n, timeZone: "Europe/Warsaw", calendar: "buddhist" };

it("clones private zoned slots with aliases, symbols and frozen cycles", () => {
  const value = createSandboxTemporalZonedDateTime(fields);
  const key = Symbol("label");
  Object.defineProperty(value, "self", { value });
  Object.defineProperty(value, key, { value: 7 });
  Object.freeze(value);
  const copy = cloneSandboxValue([value, value]);
  if (!Array.isArray(copy)) throw Error("Expected array");
  expect(copy[0]).not.toBe(value);
  expect(copy[0]).toBe(copy[1]);
  expect(temporalZonedDateTimeFields(copy[0])).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy[0], "self")?.value).toBe(copy[0]);
  expect(Object.getOwnPropertyDescriptor(copy[0], key)?.value).toBe(7);
  expect(Object.isFrozen(copy[0])).toBe(true);
});

it("imports host slots without replacing them with own shadows", () => {
  const value = new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar);
  Object.defineProperty(value, "epochNanoseconds", { value: 7n });
  const copy = deepCopyToSandbox(value);
  expect(temporalZonedDateTimeFields(copy)).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy, "epochNanoseconds")?.value).toBe(7n);
});

it("round-trips private zoned values and explicitly null prototypes", () => {
  for (const nullPrototype of [false, true]) {
    const value = createSandboxTemporalZonedDateTime(fields);
    if (nullPrototype) setSandboxPrototype(value, null);
    const host = deepCopyFromSandbox(value);
    if (nullPrototype) expect(Object.getPrototypeOf(host)).toBeNull();
    const copy = deepCopyToSandbox(host);
    expect(temporalZonedDateTimeFields(copy)).toEqual(fields);
    expect(hasNullObjectPrototype(copy as object)).toBe(nullPrototype);
  }
});

it("charges private BigInt, zone and calendar once per object", () => {
  const value = createSandboxTemporalZonedDateTime(fields);
  expect(measureSandboxData([value]) - measureSandboxData([Object.create(null)]))
    .toBe(fields.epochNanoseconds.toString(16).length + fields.timeZone.length + fields.calendar.length);
  expect(measureSandboxData([value, value])).toBe(measureSandboxData([value]));
});

it("rejects structuredClone rather than erasing private zoned slots", () => {
  expect(() => cloneSandboxValue(createSandboxTemporalZonedDateTime(fields), { structuredClone: true }))
    .toThrow(expect.objectContaining({ name: "DataCloneError" }));
});

it.each(["import", "export", "clone"] as const)("rejects own accessors without executing them on %s", direction => {
  const value = direction === "import"
    ? new Backend.ZonedDateTime(fields.epochNanoseconds, fields.timeZone, fields.calendar)
    : createSandboxTemporalZonedDateTime(fields);
  let reads = 0;
  Object.defineProperty(value, "label", { get() { reads++; return 1; } });
  const copy = direction === "import" ? deepCopyToSandbox : direction === "export" ? deepCopyFromSandbox : cloneSandboxValue;
  expect(() => copy(value as never)).toThrow(TypeError);
  expect(reads).toBe(0);
});

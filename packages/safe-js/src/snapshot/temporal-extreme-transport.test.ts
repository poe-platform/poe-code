import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { deepCopyFromSandbox, deepCopyToSandbox, type SandboxValue } from "../interp/values.js";
import { getSandboxPrototype, setSandboxPrototype } from "../interp/object-model.js";
import { Budget } from "../interp/budget.js";
import { registerRealmPrototype } from "../interp/function-realm.js";
import { temporalInstantEpoch } from "../interp/temporal-instant.js";
import { temporalDurationFields } from "../interp/temporal-duration.js";
import { temporalPlainTimeFields } from "../interp/temporal-plain-time.js";
import { temporalPlainDateFields } from "../interp/temporal-plain-date.js";
import { temporalPlainDateTimeFields } from "../interp/temporal-plain-date-time.js";
import { temporalPlainYearMonthFields } from "../interp/temporal-plain-year-month.js";
import { temporalPlainMonthDayFields } from "../interp/temporal-plain-month-day.js";
import { temporalZonedDateTimeFields } from "../interp/temporal-zoned-date-time.js";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

// These legal values exercise transport, independently of the Intl backend's
// narrower numeric-Date range. Each reader accesses owned private slots.
const cases = [
  { name: "Instant", host: () => new Backend.Instant(-8640000000000000000000n), read: temporalInstantEpoch },
  { name: "Instant", host: () => new Backend.Instant(8640000000000000000000n), read: temporalInstantEpoch },
  { name: "Duration", host: () => new Backend.Duration(4294967295), read: temporalDurationFields },
  { name: "Duration", host: () => new Backend.Duration(0, 0, 0, 0, 0, 0, -9007199254740991), read: temporalDurationFields },
  { name: "PlainTime", host: () => new Backend.PlainTime(), read: temporalPlainTimeFields },
  { name: "PlainTime", host: () => new Backend.PlainTime(23, 59, 59, 999, 999, 999), read: temporalPlainTimeFields },
  { name: "PlainDate", host: () => new Backend.PlainDate(-271821, 4, 19, "gregory"), read: temporalPlainDateFields },
  { name: "PlainDate", host: () => new Backend.PlainDate(275760, 9, 13, "buddhist"), read: temporalPlainDateFields },
  { name: "PlainDateTime", host: () => new Backend.PlainDateTime(-271821, 4, 19, 0, 0, 0, 0, 0, 1, "gregory"), read: temporalPlainDateTimeFields },
  { name: "PlainDateTime", host: () => new Backend.PlainDateTime(275760, 9, 13, 23, 59, 59, 999, 999, 999, "buddhist"), read: temporalPlainDateTimeFields },
  { name: "PlainYearMonth", host: () => new Backend.PlainYearMonth(-271821, 4, "gregory", 1), read: temporalPlainYearMonthFields },
  { name: "PlainYearMonth", host: () => new Backend.PlainYearMonth(275760, 9, "buddhist", 30), read: temporalPlainYearMonthFields },
  { name: "PlainMonthDay", host: () => new Backend.PlainMonthDay(4, 19, "gregory", -271821), read: temporalPlainMonthDayFields },
  { name: "PlainMonthDay", host: () => new Backend.PlainMonthDay(9, 13, "buddhist", 275760), read: temporalPlainMonthDayFields },
  { name: "ZonedDateTime", host: () => new Backend.ZonedDateTime(-8640000000000000000000n, "-23:59", "gregory"), read: temporalZonedDateTimeFields },
  { name: "ZonedDateTime", host: () => new Backend.ZonedDateTime(8640000000000000000000n, "+23:59", "buddhist"), read: temporalZonedDateTimeFields }
];

it.each(cases)("preserves $name endpoint slots through three host, heap and replay cycles", ({ host, read }) => {
  let value = deepCopyToSandbox(host());
  const slots = read(value);
  const source = "return 0";
  for (let cycle = 0; cycle < 3; cycle++) {
    value = deepCopyToSandbox(deepCopyFromSandbox(value));
    expect(read(value)).toEqual(slots);
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value, alias: value } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const scope = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope;
    value = scope.lookup("value").value;
    expect(scope.lookup("alias").value).toBe(value);
    expect(read(value)).toEqual(slots);
    value = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(value))));
    expect(read(value)).toEqual(slots);
  }
});

it.each(cases)("retains $name endpoint custom prototypes in the heap without granting raw replay authority", ({ name, host, read }) => {
  let value = deepCopyToSandbox(host()) as object;
  const slots = read(value);
  const first = new Budget(), second = new Budget();
  const firstPrototype = { realm: "first" }, secondPrototype = { realm: "second" };
  registerRealmPrototype(first, `Temporal.${name}`, firstPrototype);
  registerRealmPrototype(second, `Temporal.${name}`, secondPrototype);
  expect(getSandboxPrototype(value, first)).toBe(firstPrototype);
  expect(getSandboxPrototype(value, second)).toBe(secondPrototype);
  const custom = deepCopyToSandbox({ marker: "custom" }) as object;
  setSandboxPrototype(value, custom);
  Object.defineProperty(value, "self", { value });
  Object.freeze(value);
  const source = "return 0";
  for (let cycle = 0; cycle < 3; cycle++) {
    expect(() => encodeReplayData(value as SandboxValue)).toThrow("Guest function properties and prototype links cannot be serialized.");
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value: value as SandboxValue } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    value = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("value").value as object;
    expect(read(value)).toEqual(slots);
    expect(getSandboxPrototype(value, first)).toBe(getSandboxPrototype(value, second));
    expect(getSandboxPrototype(value, first)).toMatchObject({ marker: "custom" });
    expect(Object.getOwnPropertyDescriptor(value, "self")?.value).toBe(value);
    expect(Object.isFrozen(value)).toBe(true);
  }
});

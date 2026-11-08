import { expect, it } from "vitest";
import { createSandboxTemporalPlainTime, temporalPlainTimeFields } from "../interp/temporal-plain-time.js";
import { getSandboxPrototype, setSandboxPrototype } from "../interp/object-model.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

const zeroFields = { hour: 0, minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 };

it.each([zeroFields, { hour: 23, minute: 59, second: 59, millisecond: 999, microsecond: 999, nanosecond: 999 }])(
  "restores PlainTime private fields, prototypes, aliases and frozen cycles: %j", fields => {
    const value = createSandboxTemporalPlainTime(fields);
    const prototype = { marker: "origin" };
    const key = Symbol("self");
    setSandboxPrototype(value, prototype);
    Object.defineProperty(value, key, { value });
    Object.defineProperty(value, "hour", { value: 7 });
    Object.freeze(value);
    const source = "return 0";
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "module", bindings: { value, alias: value, prototype, key } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const scope = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope;
    const restored = scope.lookup("value").value;
    const restoredKey = scope.lookup("key").value;
    if (typeof restoredKey !== "symbol") throw new Error("Missing symbol");
    expect(temporalPlainTimeFields(restored)).toEqual(fields);
    expect(scope.lookup("alias").value).toBe(restored);
    expect(getSandboxPrototype(restored as object)).toBe(scope.lookup("prototype").value);
    expect(Object.getOwnPropertyDescriptor(restored, restoredKey)).toEqual({ value: restored, writable: false, enumerable: false, configurable: false });
    expect(Object.getOwnPropertyDescriptor(restored, "hour")?.value).toBe(7);
    expect(Object.isFrozen(restored)).toBe(true);
  }
);

it("recaptures identical private fields after restoration", () => {
  const source = "return 0";
  const save = (value: ReturnType<typeof createSandboxTemporalPlainTime>) => serialize({
    source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const first = save(createSandboxTemporalPlainTime({ hour: 23, nanosecond: 999 }));
  const value = restore(JSON.parse(JSON.stringify(first)), { source }).currentScope.lookup("value").value;
  expect(temporalPlainTimeFields(value).nanosecond).toBe(999);
  expect(save(value as ReturnType<typeof createSandboxTemporalPlainTime>)).toEqual(first);
});

it("rejects accessor slot encodings without invoking them", () => {
  let reads = 0;
  const slots = { ...zeroFields };
  Object.defineProperty(slots, "hour", { get() { reads++; return 1; } });
  const node = { kind: "guest-temporal-plain-time", slots, state: { properties: { properties: [], extensible: true } } };
  expect(() => validateGuestHeapNode(node, { "1": node })).toThrow(TypeError);
  expect(reads).toBe(0);
});

it.each([
  null, [], {}, { ...zeroFields, extra: 0 }, { ...zeroFields, hour: "1" },
  { ...zeroFields, hour: -0 }, { ...zeroFields, hour: NaN }, { ...zeroFields, hour: Infinity },
  { ...zeroFields, hour: -1 }, { ...zeroFields, hour: 0.5 }, { ...zeroFields, hour: 24 },
  { ...zeroFields, minute: 60 }, { ...zeroFields, second: 60 },
  { ...zeroFields, millisecond: 1000 }, { ...zeroFields, microsecond: 1000 }, { ...zeroFields, nanosecond: 1000 }
].map(slots => [slots]))("rejects malformed PlainTime slots %j", slots => {
  const valid = { kind: "guest-temporal-plain-time", slots: zeroFields, state: { properties: { properties: [], extensible: true } } };
  expect(validateGuestHeapNode(valid, { "1": valid })).toBe(true);
  const node = { ...valid, slots };
  expect(() => validateGuestHeapNode(node, { "1": node })).toThrow();
});

it.each([{ extra: 0 }, { state: null }])("rejects invalid PlainTime node metadata %j", changes => {
  const valid = { kind: "guest-temporal-plain-time", slots: zeroFields, state: { properties: { properties: [], extensible: true } } };
  expect(validateGuestHeapNode(valid, { "1": valid })).toBe(true);
  const node = { ...valid, ...changes };
  expect(() => validateGuestHeapNode(node, { "1": node })).toThrow();
});

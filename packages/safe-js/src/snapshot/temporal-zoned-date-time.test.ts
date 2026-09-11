import { expect, it } from "vitest";
import { createSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../interp/temporal-zoned-date-time.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

const slots = { epochNanoseconds: "123456789", timeZone: "Europe/Warsaw", calendar: "buddhist" };
const fields = { ...slots, epochNanoseconds: BigInt(slots.epochNanoseconds) };

it("restores zoned private slots, aliases and frozen cycles from a JSON heap", () => {
  const value = createSandboxTemporalZonedDateTime(fields);
  Object.defineProperty(value, "self", { value });
  Object.freeze(value);
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value, alias: value } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const scope = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope;
  const result = scope.lookup("value").value;
  expect(temporalZonedDateTimeFields(result)).toEqual(fields);
  expect(scope.lookup("alias").value).toBe(result);
  expect(Object.getOwnPropertyDescriptor(result, "self")?.value).toBe(result);
  expect(Object.isFrozen(result)).toBe(true);
});

it.each([
  {}, { ...slots, epochNanoseconds: "01" }, { ...slots, epochNanoseconds: "-0" },
  { ...slots, epochNanoseconds: "8640000000000000000001" }, { ...slots, epochNanoseconds: 1 },
  { ...slots, timeZone: "europe/warsaw" }, { ...slots, timeZone: "-00:00" },
  { ...slots, timeZone: "Invalid/Zone" }, { ...slots, calendar: "ISO8601" },
  { ...slots, extra: true }
])("validates zoned heap kind and rejects malformed slots: %j", invalid => {
  const node = { kind: "guest-temporal-zoned-date-time", slots, state: { properties: { properties: [], extensible: true } } };
  expect(validateGuestHeapNode(node, { "1": node })).toBe(true);
  expect(() => validateGuestHeapNode({ ...node, slots: invalid }, { "1": node })).toThrow();
});

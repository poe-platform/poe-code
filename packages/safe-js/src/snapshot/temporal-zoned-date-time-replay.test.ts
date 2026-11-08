import { expect, it } from "vitest";
import { createSandboxTemporalZonedDateTime, temporalZonedDateTimeFields } from "../interp/temporal-zoned-date-time.js";
import { setSandboxPrototype, hasNullObjectPrototype } from "../interp/object-model.js";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";

const slots = { epochNanoseconds: "123456789", timeZone: "Europe/Warsaw", calendar: "buddhist" };
const fields = { ...slots, epochNanoseconds: BigInt(slots.epochNanoseconds) };

it("round-trips zoned replay slots with symbols, aliases, frozen cycles and null prototypes", () => {
  const value = createSandboxTemporalZonedDateTime(fields);
  const key = Symbol("cycle");
  setSandboxPrototype(value, null);
  Object.defineProperty(value, key, { value });
  Object.freeze(value);
  const saved = encodeReplayData([value, value, key]);
  const result = decodeReplayData(JSON.parse(JSON.stringify(saved)));
  if (!Array.isArray(result) || typeof result[2] !== "symbol") throw Error("Invalid graph");
  expect(result[0]).toBe(result[1]);
  expect(temporalZonedDateTimeFields(result[0])).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(result[0], result[2])?.value).toBe(result[0]);
  expect(Object.isFrozen(result[0])).toBe(true);
  expect(hasNullObjectPrototype(result[0] as object)).toBe(true);
  expect(encodeReplayData(result)).toEqual(saved);
});

it.each([
  {}, { ...slots, epochNanoseconds: "01" }, { ...slots, epochNanoseconds: "-0" },
  { ...slots, epochNanoseconds: "8640000000000000000001" }, { ...slots, epochNanoseconds: 1 },
  { ...slots, timeZone: "europe/warsaw" }, { ...slots, timeZone: "-00:00" },
  { ...slots, timeZone: "Invalid/Zone" }, { ...slots, calendar: "ISO8601" },
  { ...slots, extra: true }
])("rejects noncanonical zoned replay slots: %j", invalid => {
  const graph = { root: { tag: "ref", id: 0 }, nodes: [{ kind: "temporal-zoned-date-time", slots }] };
  expect(temporalZonedDateTimeFields(decodeReplayData(graph))).toEqual(fields);
  expect(() => decodeReplayData({ ...graph, nodes: [{ kind: "temporal-zoned-date-time", slots: invalid }] })).toThrow();
});

it.each([-8640000000000000000000n, 8640000000000000000000n])("preserves exact epoch endpoint %s in JSON", epochNanoseconds => {
  const value = createSandboxTemporalZonedDateTime({ ...fields, epochNanoseconds });
  const saved = JSON.parse(JSON.stringify(encodeReplayData(value)));
  expect(temporalZonedDateTimeFields(decodeReplayData(saved))).toEqual({ ...fields, epochNanoseconds });
});

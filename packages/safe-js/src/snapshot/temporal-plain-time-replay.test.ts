import { expect, it } from "vitest";
import { createSandboxTemporalPlainTime, temporalPlainTimeFields } from "../interp/temporal-plain-time.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "../interp/object-model.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";

const zeroFields = { hour: 0, minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 };

it.each([zeroFields, { hour: 23, minute: 59, second: 59, millisecond: 999, microsecond: 999, nanosecond: 999 }])(
  "preserves PlainTime fields, aliases and frozen symbol cycles: %j", fields => {
    const value = createSandboxTemporalPlainTime(fields);
    const key = Symbol("self");
    Object.defineProperty(value, key, { value });
    Object.defineProperty(value, "hour", { value: 7 });
    Object.freeze(value);
    setSandboxPrototype(value, null);
    const saved = encodeReplayData([value, value, key]);
    const restored = decodeReplayData(JSON.parse(JSON.stringify(saved)));
    if (!Array.isArray(restored) || typeof restored[2] !== "symbol") throw new Error("Invalid graph");
    expect(restored[0]).toBe(restored[1]);
    expect(temporalPlainTimeFields(restored[0])).toEqual(fields);
    expect(Object.getOwnPropertyDescriptor(restored[0], restored[2])).toEqual({ value: restored[0], writable: false, enumerable: false, configurable: false });
    expect(Object.getOwnPropertyDescriptor(restored[0], "hour")?.value).toBe(7);
    expect(Object.isFrozen(restored[0])).toBe(true);
    expect(hasNullObjectPrototype(restored[0] as object)).toBe(true);
    expect(encodeReplayData(restored)).toEqual(saved);
  }
);

it.each([
  null, [], {}, { ...zeroFields, extra: 0 }, { ...zeroFields, hour: "1" },
  { ...zeroFields, hour: -0 }, { ...zeroFields, hour: NaN }, { ...zeroFields, hour: Infinity },
  { ...zeroFields, hour: -1 }, { ...zeroFields, hour: 0.5 }, { ...zeroFields, hour: 24 },
  { ...zeroFields, minute: 60 }, { ...zeroFields, second: 60 },
  { ...zeroFields, millisecond: 1000 }, { ...zeroFields, microsecond: 1000 }, { ...zeroFields, nanosecond: 1000 }
].map(slots => [slots]))("rejects malformed replay slots %j", slots => {
  const node = { kind: "temporal-plain-time", slots: zeroFields };
  const graph = { root: { tag: "ref", id: 0 }, nodes: [node] };
  expect(temporalPlainTimeFields(decodeReplayData(graph))).toEqual(zeroFields);
  expect(() => decodeReplayData({ ...graph, nodes: [{ ...node, slots }] })).toThrow();
});

it.each([{ extensible: "false" }, { nullPrototype: false }, { properties: [] }, { unexpected: true },
  { properties: { label: { value: 1, enumerable: true, writable: "yes", configurable: true } } },
  { symbolProperties: [[1, { value: 2, enumerable: true, writable: true, configurable: true }]] }
])("rejects malformed replay metadata %j", fields => {
  const node = { kind: "temporal-plain-time", slots: zeroFields };
  expect(temporalPlainTimeFields(decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [node] }))).toEqual(zeroFields);
  expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [{ ...node, ...fields }] })).toThrow();
});

it("rejects encoded slot accessors without invoking them", () => {
  let reads = 0;
  const slots = { ...zeroFields };
  Object.defineProperty(slots, "hour", { get() { reads++; return 1; } });
  expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [{ kind: "temporal-plain-time", slots }] }))
    .toThrow(expect.objectContaining({ name: "SnapshotValidationError", code: "invalidType", path: "$.nodes[0].slots.hour" }));
  expect(reads).toBe(0);
});

it("rejects accessor properties without invoking them during recording", () => {
  const value = createSandboxTemporalPlainTime();
  let reads = 0;
  Object.defineProperty(value, "label", { get() { reads++; return 7; } });
  expect(() => encodeReplayData(value)).toThrow(TypeError);
  expect(reads).toBe(0);
});

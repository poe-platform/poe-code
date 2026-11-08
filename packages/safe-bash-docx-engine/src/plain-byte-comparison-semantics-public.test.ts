import { expect, it } from "vitest";
import { iterableEquality, equals } from "@vitest/expect";
import "../tests/fixtures/text.js";

const values = () => Uint8Array.from({ length: 256 }, (_, index) => index);
const cases: readonly [string, () => readonly [unknown, unknown]][] = [
  ["independent dense copies", () => [values(), values()]],
  ["empty independent copies", () => [new Uint8Array(), new Uint8Array()]],
  ["unequal lengths", () => [values(), values().subarray(0, 255)]],
  ["unequal first byte", () => { const changed = values(); changed[0] = 1; return [values(), changed]; }],
  ["unequal middle byte", () => { const changed = values(); changed[128] = 127; return [values(), changed]; }],
  ["unequal last byte", () => { const changed = values(); changed[255] = 254; return [values(), changed]; }],
  ["equal scoped views with unrelated surrounding bytes", () => [Uint8Array.of(9, 0, 1, 8).subarray(1, 3), Uint8Array.of(7, 0, 1, 6).subarray(1, 3)]],
  ["same underlying buffer different data", () => { const buffer = Uint8Array.of(0, 1, 1, 0); return [buffer.subarray(0, 2), buffer.subarray(2, 4)]; }],
  ["buffer subclass", () => [Uint8Array.of(0, 1), Buffer.from([0, 1])]],
  ["different numeric typed arrays", () => [Uint8Array.of(0, 1), Uint16Array.of(0, 1)]],
  ["ordinary arrays", () => [Uint8Array.of(0, 1), [0, 1]]],
  ["same enumerable custom property", () => [Object.assign(values(), { note: "Retained" }), Object.assign(values(), { note: "Retained" })]],
  ["different enumerable custom property", () => [Object.assign(values(), { note: "Retained" }), Object.assign(values(), { note: "Changed" })]],
  ["absent versus undefined custom property", () => [Object.assign(values(), { note: undefined }), values()]],
  ["nonenumerable custom metadata", () => [Object.defineProperty(values(), "note", { value: "Retained" }), values()]],
  ["own symbolic metadata", () => { const key = Symbol("original"); return [Object.assign(values(), { [key]: "Retained" }), Object.assign(values(), { [key]: "Changed" })]; }]
];
for (const [name, make] of cases) for (const reverse of [false, true])
it(`native byte comparison keeps the original equality oracle; case=${name}; reverse=${reverse}`, () => {
  const pair = make(), [actual, expected] = reverse ? [pair[1], pair[0]] : pair;
  const baseline = equals(actual, expected, [iterableEquality]);
  if (baseline) expect(actual).toEqual(expected);
  else expect(() => expect(actual).toEqual(expected)).toThrow();
});

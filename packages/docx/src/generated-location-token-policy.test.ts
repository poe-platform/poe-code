import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import * as tokens from "./location-token.js";
import { InvalidValueError, ResourceLimitError } from "./archive.js";

const payload: tokens.LocationPayload = { version: 1, sourceSha256: "a".repeat(64), generation: 0,
  part: "/word/document.xml", story: "/word/document.xml#body", path: [0, 0], range: null };
const generated = (tokens as typeof tokens & { encodeGeneratedLocation: typeof tokens.encodeLocation }).encodeGeneratedLocation;

for (const size of [24575, 24576, 24577])
it(`preserves canonical byte capacity and raw caller policy at ${size}`, () => {
  const value = { ...payload, path: Array<number>(10000).fill(0), story: "a" };
  value.story += "a".repeat(size - Buffer.byteLength(JSON.stringify(value)));
  const memory = Volume.fromJSON({ "/payload": JSON.stringify(value) });
  const before = String(memory.readFileSync("/payload"));
  const input = JSON.parse(before) as tokens.LocationPayload;
  expect(Buffer.byteLength(before)).toBe(size);
  if (size <= 24576) {
    expect(generated(input)).toBe(tokens.encodeLocation(input));
    expect(tokens.decodeLocation(generated(input))).toEqual(value);
  } else {
    expect(() => tokens.encodeLocation(input)).toThrowError(InvalidValueError);
    expect(() => tokens.encodeLocation(input)).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(() => generated(input)).toThrowError(ResourceLimitError);
    expect(() => generated(input)).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  }
  expect(String(memory.readFileSync("/payload"))).toBe(before);
});

it("rejects impossible generated paths before descriptor enumeration", () => {
  const path = Array<number>(13000).fill(0), native = Reflect.ownKeys;
  let enumerations = 0;
  const spy = vi.spyOn(Reflect, "ownKeys").mockImplementation(value => {
    if (value === path) enumerations++;
    return native(value);
  });
  try {
    expect(() => generated({ ...payload, path })).toThrowError(ResourceLimitError);
    expect(enumerations).toBe(0);
    expect(path).toEqual(Array<number>(13000).fill(0));
  } finally { spy.mockRestore(); }
});

for (const bad of [
  { ...payload, generation: -1 }, { ...payload, sourceSha256: "A".repeat(64) },
  { ...payload, path: [1.5] }, { ...payload, path: [-1] },
  { ...payload, part: "/word/../document.xml" }, { ...payload, range: { start: 3, end: 2 } },
  { ...payload, extra: true }, { ...payload, version: 2 }
]) it(`retains invalid-value classification for malformed generated data ${JSON.stringify(bad)}`, () => {
  expect(() => generated(bad as tokens.LocationPayload)).toThrowError(InvalidValueError);
  expect(() => generated(bad as tokens.LocationPayload)).toThrowError(expect.objectContaining({ code: "usage" }));
});

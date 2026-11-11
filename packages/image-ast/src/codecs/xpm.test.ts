import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./index.js";

const xpm = (...lines: string[]): Uint8Array => new TextEncoder().encode(`/* XPM */\n/* ignored "comment" */\nstatic char *x[] = {${lines.map(line => JSON.stringify(line)).join(",")}};`);

it("reads XPM metadata and escaped pixel symbols", () => {
  const input = xpm("2 1 2 1", '\\ c #f00', '" c None', '\\"');
  expect(readImageMetadata(input)).toMatchObject({ format: "xpm", width: 2, height: 1, hasAlpha: true });
  expect(decodeImage(input).data).toEqual(Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0]));
});

it("reads a literal tab between a palette symbol and its field key", () => {
  const input = new TextEncoder().encode('/* XPM */\nstatic char *x[] = {"2 1 2 1", "A\tc red", " \tc blue", "A "};');
  expect(readImageMetadata(input)).toMatchObject({ format: "xpm", width: 2, height: 1 });
  expect(decodeImage(input).data).toEqual(Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]));
});

it.each([
  ["1 1 1 1", "a c red", "b"],
  ["2 1 1 1", "a c red", "a"],
  ["1 1 1 1", "a c #zzzzzz", "a"],
  ["1 1 2 1", "a c red", "a c blue", "a"],
  ["1 1 1 1", "a c red"],
  ["-1 1 1 1", "a c red", "a"]
])("rejects malformed XPM input: %s", (...lines) => {
  expect(() => decodeImage(xpm(...lines))).toThrow(/XPM/);
});

it("checks the pixel limit before decoding", () => {
  expect(() => decodeImage(xpm("2 1 1 1", "a c red", "aa"), { limitInputPixels: 1 })).toThrow("pixel limit");
});

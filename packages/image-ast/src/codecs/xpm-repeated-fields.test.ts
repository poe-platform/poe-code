import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./index.js";

const xpm = (...lines: string[]): Uint8Array => new TextEncoder().encode(`/* XPM */\n/* ignored "comment" */\nstatic char *x[] = {${lines.map(line => JSON.stringify(line)).join(",")}};`);

it.each([
  ...["c", "g", "g4", "m", "s"].map(key => [`${key} red ${key} blue`, [255, 0, 0, 255]] as const),
  ["g blue c red", [255, 0, 0, 255]],
  ["c red g blue c blue", [255, 0, 0, 255]],
  ["c None c red", [0, 0, 0, 0]],
  ["c red c None", [255, 0, 0, 255]]
] as const)("uses the first XPM field at the highest priority: %s", (fields, pixels) => {
  const input = xpm("1 1 1 1", `a ${fields}`, "a");
  expect(decodeImage(input).data).toEqual(Uint8Array.from(pixels));
  expect(readImageMetadata(input).hasAlpha).toBe(pixels[3] === 0);
});

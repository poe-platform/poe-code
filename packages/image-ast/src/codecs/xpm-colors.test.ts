import { expect, it } from "vitest";
import { parseColor } from "../ast.js";
import { decodeImage, readImageMetadata } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI XPM input, exported as RGBA8.
it.each([
  ["green", [0, 255, 0]],
  ["gray", [190, 190, 190]],
  ["grey", [190, 190, 190]],
  ["maroon", [176, 48, 96]],
  ["purple", [160, 32, 240]],
  ["grey50", [127, 127, 127]],
  ["gray90", [229, 229, 229]],
  ["gray1", [3, 3, 3]],
  ["grey0", [0, 0, 0]],
  ["gray100", [255, 255, 255]],
  ["Light Goldenrod Yellow", [250, 250, 210]],
  ["navy blue", [0, 0, 128]],
  ["LiGhT SlAtE GrAy", [119, 136, 153]],
  ["light slate grey", [119, 136, 153]],
  ["VioletRed", [208, 32, 144]],
  ["red", [255, 0, 0]],
  ["#123456", [18, 52, 86]],
  ["rgb(1,2,3)", [1, 2, 3]]
] as const)("decodes the XPM color %s", (color, rgb) => {
  const input = new TextEncoder().encode(`/* XPM */\nstatic char *x[]={"1 1 1 1","A c ${color}","A"};`);
  expect(readImageMetadata(input)).toMatchObject({ hasAlpha: false, channels: 3 });
  expect([...decodeImage(input).data]).toEqual([...rgb, 255]);
});

it.each(["lime", "green4", "DarkGray", "gray101", "gray050", "unknown", "constructor", "__proto__"])("rejects the non-XPM color %s", color => {
  const input = new TextEncoder().encode(`/* XPM */\nstatic char *x[]={"1 1 1 1","A c ${color}","A"};`);
  expect(() => decodeImage(input)).toThrow("Invalid XPM color");
});

it("keeps CSS color values outside XPM decoding", () => {
  expect(parseColor("green")).toEqual({ r: 0, g: 128, b: 0, a: 255 });
  expect(parseColor("gray")).toEqual({ r: 128, g: 128, b: 128, a: 255 });
});

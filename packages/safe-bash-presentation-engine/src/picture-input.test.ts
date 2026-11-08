import { expect, it } from "vitest";
import { validatePictureInput } from "./picture-input.js";
const png = () =>
  Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 80, 141, 238, 255, 15, 0, 3,
    199, 2, 15, 253, 11, 32, 105, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
  ]);
it("accepts bounded raster container structure", () => {
  expect(validatePictureInput(png())).toBe("png");
});
it.each([
  new Uint8Array(),
  Uint8Array.from([255, 216, 255, 217]),
  png().slice(0, 24),
  png().slice(0, -1)
])("rejects incomplete raster containers", (bytes) => {
  expect(() => validatePictureInput(bytes)).toThrow();
});
it("rejects zero dimensions and trailing bytes", () => {
  const zero = png();
  zero[19] = 0;
  expect(() => validatePictureInput(zero)).toThrow();
  expect(() => validatePictureInput(Uint8Array.from([...png(), 0]))).toThrow();
});
it("accepts a structured frame and scan container", () => {
  const bytes = Uint8Array.from([
    255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 42,
    255, 217
  ]);
  expect(validatePictureInput(bytes)).toBe("jpeg");
});

it("rejects corrupt PNG chunk checksums", () => {
  const bytes = png();
  bytes[29] = 0;
  expect(() => validatePictureInput(bytes)).toThrow();
});

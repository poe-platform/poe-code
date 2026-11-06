import { expect, it } from "vitest";
import { jpegColor } from "./jpeg-color.js";

it.each([false, true])("converts CMYK and YCCK channels with strip=%s", (strip) => {
  const rgb = (y: number, cb: number, cr: number, k: number, transform: number | undefined) => {
    const packed = jpegColor(y, cb - 128, cr - 128, k, strip, false, transform);
    return [packed & 255, (packed >>> 8) & 255, packed >>> 16];
  };
  expect(rgb(200, 100, 50, 128, 0)).toEqual([100, 50, 25]);
  expect(rgb(55, 155, 205, 127, undefined)).toEqual([100, 50, 25]);
  expect(rgb(0, 128, 128, 255, 2)).toEqual([255, 255, 255]);
  expect(rgb(255, 128, 128, 255, 2)).toEqual([0, 0, 0]);
  expect(rgb(100, 128, 128, 128, 2)).toEqual([78, 78, 78]);
});

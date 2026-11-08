import { expect, it } from "vitest";
import { decodeJpegImage, encodeJpegImage } from "./jpeg.js";
import type { RgbaImage } from "../ast.js";

const image: RgbaImage = { width: 35, height: 19, data: Uint8Array.from({ length: 35 * 19 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 251), format: "raw", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false };
for (const interval of [0, 1, 2, 7, 15, 16, 256, 65535]) {
  it(`encodes interval ${interval} with partial edge blocks`, () => {
    const bytes = encodeJpegImage(image, { jpegRestartInterval: interval });
    expect(decodeJpegImage(bytes).data).toEqual(decodeJpegImage(encodeJpegImage(image)).data);
    const markers = Array.from(bytes).flatMap((b, i) => b === 255 && bytes[i + 1]! >= 0xd0 && bytes[i + 1]! <= 0xd7 ? [bytes[i + 1]!] : []);
    expect(markers.length).toBe(interval === 0 ? 0 : Math.floor(14 / interval));
    const dri = bytes.findIndex((b, i) => b === 255 && bytes[i + 1] === 0xdd);
    if (interval === 0) expect(dri).toBe(-1);
    else expect(Array.from(bytes.subarray(dri + 2, dri + 6))).toEqual([0, 4, interval >>> 8, interval & 255]);
  });
}
for (const interval of [-1, 0.5, 65536, NaN, Infinity]) {
  it(`rejects invalid interval ${interval}`, () => {
    expect(() => encodeJpegImage(image, { jpegRestartInterval: interval })).toThrow(/restart interval/);
  });
}

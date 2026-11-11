import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";

const bitmap = (width: number, values: string) => new TextEncoder().encode(`#define test_width ${width}\n#define test_height 2\nstatic unsigned short test_bits[] = { ${values} };`);

it.each([1, 7, 8, 9, 13, 15, 16, 17, 24, 25, 32, 33])("ignores short-array padding for width %s", width => {
  const words = Math.ceil(width / 16);
  const bytes = bitmap(width, [...Array<string>(words).fill("0xffff"), ...Array<string>(words).fill("0x0000")].join(","));
  const image = decodeImage(bytes);
  expect(readImageMetadata(bytes)).toMatchObject({ format: "xbm", width, height: 2, channels: 1, hasAlpha: false });
  for (let i = 0; i < width * 2; i++) expect([...image.data.subarray(i * 4, i * 4 + 4)]).toEqual(i < width ? [0, 0, 0, 255] : [255, 255, 255, 255]);
});

it.each(["65536,0", "-1,0", "1.5,0", "0", "0,0,0"])("rejects invalid short arrays: %s", values => {
  expect(() => decodeImage(bitmap(8, values))).toThrow("XBM");
});

it("enforces short-array pixel limits before reading data", () => {
  expect(() => decodeImage(bitmap(13, ""), { limitInputPixels: 25 })).toThrow("pixel limit");
});

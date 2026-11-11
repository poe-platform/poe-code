import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { isXbmBytes, readXbmFromSource } from "./codecs/xbm.js";
import { readImageMetadataFromSource } from "./codecs/metadata-source.js";

const bitmap = (width: number, height: number, values: string) => new TextEncoder().encode(`#define test_width ${width}\n#define test_height ${height}\nstatic char test_bits[] = { ${values} };`);

it.each(["\n", "\r\n"])("treats includes and guards as inert header lines with %j newlines", async newline => {
  const bytes = new TextEncoder().encode([
    '#include "missing/char{.h"', "#ifndef TILE_ICON", "#define TILE_ICON",
    "#define test_width 1", "#define test_height 1", "static char test_bits[] = { 1 };", "#endif"
  ].join(newline));
  const metadata = { format: "xbm", width: 1, height: 1 };
  expect(readImageMetadata(bytes)).toMatchObject(metadata);
  expect([...decodeImage(bytes).data]).toEqual([0, 0, 0, 255]);
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  await expect(readImageMetadataFromSource(source, new AbortController().signal)).resolves.toMatchObject(metadata);
});

it.each([1, 7, 8, 9, 16, 17])("ignores set padding bits for width %s", width => {
  const stride = Math.ceil(width / 8);
  const bytes = bitmap(width, 2, [...Array<string>(stride).fill("0xff"), ...Array<string>(stride).fill("0x00")].join(","));
  const image = decodeImage(bytes);
  expect(readImageMetadata(bytes)).toMatchObject({ format: "xbm", width, height: 2, channels: 1, hasAlpha: false });
  for (let i = 0; i < width * 2; i++) expect([...image.data.subarray(i * 4, i * 4 + 4)]).toEqual(i < width ? [0, 0, 0, 255] : [255, 255, 255, 255]);
});

it.each([
  bitmap(0, 1, "0"), bitmap(1, -1, "0"), bitmap(13, 5, "7,0"), bitmap(1, 1, "0xgg"), bitmap(1, 1, "-1"), bitmap(1, 1, "0,0")
])("rejects malformed XBM", bytes => {
  expect(() => decodeImage(bytes)).toThrow("XBM");
});

it("enforces pixel limits before allocating pixels", () => {
  expect(() => decodeImage(bitmap(13, 5, ""), { limitInputPixels: 64 })).toThrow("pixel limit");
});

it("honors cancellation and rejects truncated retained reads", async () => {
  const bytes = bitmap(1, 1, "1");
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(readXbmFromSource(source, undefined, controller.signal)).rejects.toThrow("cancelled");
  await expect(readXbmFromSource({ ...source, async read() { return new Uint8Array(); } }, undefined, new AbortController().signal)).rejects.toThrow("Truncated XBM source");
});

it("rejects explicitly sized XBM arrays before reading pixels or metadata", async () => {
  const bytes = new TextEncoder().encode("#define cur_width 8\n#define cur_height 2\nstatic char cur_bits[2] = { 0x01, 0x80 };");
  expect(() => decodeImage(bytes)).toThrow("XBM");
  expect(() => readImageMetadata(bytes)).toThrow("XBM");
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  await expect(readXbmFromSource(source, undefined, new AbortController().signal)).rejects.toThrow("XBM");
});

it.each([
  "/* XPM */\nstatic char *icon[] = {",
  "/* ordinary C */\nstatic char data[] = { 1 };",
  "#defineSomething 1",
  "#includeSomething 1",
  "#ifndefSomething 1",
  "/* unterminated #define test_width 8",
  "/* comment */\n#define"
])("does not admit unrelated or incomplete headers: %s", header => {
  expect(isXbmBytes(new TextEncoder().encode(header))).toBe(false);
});

it("ignores leading C comment contents when reading XBM metadata and pixels", () => {
  const bytes = new TextEncoder().encode("/* #define short { */\n# \tdefine\ttest_width 1\n#define test_height 1\nstatic char test_bits[] = { 1 };");
  expect(readImageMetadata(bytes)).toMatchObject({ format: "xbm", width: 1, height: 1 });
  expect([...decodeImage(bytes).data]).toEqual([0, 0, 0, 255]);
});

it.each(["/* pixel */ 1", "/* unfinished", "1, /* row two */ 0"])("rejects comments in XBM pixels: %s", async values => {
  const bytes = bitmap(1, values.startsWith("1,") ? 2 : 1, values);
  expect(() => decodeImage(bytes)).toThrow("improper image header");
  expect(() => readImageMetadata(bytes)).toThrow("improper image header");
  const source = { size: bytes.length, async read(position: number, length: number) { return bytes.subarray(position, position + length); } };
  await expect(readXbmFromSource(source, undefined, new AbortController().signal)).rejects.toThrow("improper image header");
});

it.each([
  ["129", [0, 3, 5]],
  ["0201", [0]],
  ["256", [1, 2, 4, 6]],
  ["0XAf", [0, 1, 2, 3, 5, 7]]
] as const)("reads hexadecimal byte values and discards high bits: %s", (value, blackPixels) => {
  const image = decodeImage(bitmap(8, 1, value));
  expect([...image.data.filter((_, index) => index % 4 === 0)]).toEqual(
    Array.from({ length: 8 }, (_, index) => (blackPixels as readonly number[]).includes(index) ? 0 : 255)
  );
});

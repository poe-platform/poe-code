import { expect, it } from "vitest";
import { createTiffLayout } from "./codecs/tiff-layout.js";

it("keeps BigTIFF directory and pixel offsets above 4 GiB without truncation", () => {
  const image = { width: 1, height: 1, hasAlpha: false, space: "srgb" as const };
  const offset = 0x100000000;
  expect(() => createTiffLayout(image, {}, offset, true)).toThrow("classic TIFF offsets");
  const { directory, end } = createTiffLayout(image, { tiffBig: true }, offset, true);
  const view = new DataView(directory.buffer), count = Number(view.getBigUint64(0, true));
  const strip = Array.from({ length: count }, (_, i) => 8 + i * 20).find(at => view.getUint16(at, true) === 273)!;
  expect(view.getUint16(strip + 2, true)).toBe(16);
  expect(view.getBigUint64(strip + 12, true)).toBe(BigInt(offset + directory.length));
  expect(view.getBigUint64(8 + count * 20, true)).toBe(BigInt(end));
  expect(end % 8).toBe(0);
});

it("rejects BigTIFF layouts beyond exact backing offsets before allocation", () => {
  expect(() => createTiffLayout({ width: 1, height: 1, hasAlpha: false, space: "srgb" }, { tiffBig: true }, Number.MAX_SAFE_INTEGER)).toThrow("safe BigTIFF offsets");
});

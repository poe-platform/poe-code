import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeImage } from "./index.js";
import { encodeStoredImage } from "../image-encode.js";
import { encodeUilFromStorage } from "./uil-output.js";

it("keeps palette order and escapes UIL symbols across bounded chunks", async () => {
  const colors = Array.from({ length: 93 }, (_, i) => 0xff000000 + i * 65536);
  const indices = Uint8Array.from({ length: 4400 }, (_, i) => i % colors.length);
  const image: RgbaImage = { width: 2200, height: 2,
    data: Uint8Array.from(Array.from(indices, i => [i, 0, 0, 255]).flat()),
    format: "raw", space: "srgb", channels: 3, depth: "uchar", hasAlpha: false, density: 72,
    isPalette: true, indexedColors: colors, pngIndices: indices };
  const storage = Buffer.concat([image.data, indices]);
  const chunks: Uint8Array[] = [], options = { format: "uil" as const, outputFilename: "/icons/app-icon.uil" };
  for await (const chunk of encodeStoredImage({ ...image, position: 0, storedPngIndices: { position: image.data.length, width: image.width, height: image.height } }, {
    allocate() { throw new Error("Unexpected allocation"); },
    async read(position, length) { expect(length).toBeLessThanOrEqual(4096); return storage.subarray(position, position + length); },
    async write() { throw new Error("Unexpected write"); },
  }, new AbortController().signal, options)) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  expect(text).toBe(new TextDecoder().decode(encodeImage(image, options).data));
  expect(text).toContain("app_icon_ct : color_table(");
  expect(text).toContain("color('#000000FF',background) = '  '");
  expect(text).toContain("color('#560000FF',background) = ''' '");
  expect(text).toContain("color('#5C0000FF',background) = ' .'");
  const rows = text.split("\n").filter(line => line.startsWith('    "'));
  expect(rows).toHaveLength(2);
  expect(rows[0]!.slice(5, -2)).toHaveLength(4400);
  expect(rows[1]!.slice(5, -3)).toHaveLength(4400);
  expect(rows[0]!.slice(5, 11)).toBe("  . X ");
  expect(rows[1]!.slice(5, 11)).toBe("S D F ");
});

it.each([false, true])("rejects truncated storage and honors cancellation (aborted=%s)", async aborted => {
  const controller = new AbortController();
  if (aborted) controller.abort(new Error("cancelled"));
  const output = encodeUilFromStorage({ width: 1, height: 1, position: 0,
    format: "raw", space: "srgb", channels: 3, depth: "uchar", hasAlpha: false, density: 72 }, {
    allocate() { throw new Error("Unexpected allocation"); },
    async read() { return new Uint8Array(); },
    async write() { throw new Error("Unexpected write"); },
  }, controller.signal);
  await expect(output.next()).rejects.toThrow(aborted ? "cancelled" : "Truncated UIL pixel storage");
});

it.each([true, false])("selects UIL through the sharp API and filename (retained=%s)", async retained => {
  const { default: sharp } = await import("../index.js");
  const { MemoryFileSystem } = await import("@poe-code/safe-fs/core");
  const filesystem = new MemoryFileSystem();
  const input = encodeImage({ width: 2, height: 1, data: Uint8Array.of(255, 0, 0, 255, 255, 0, 0, 255),
    format: "raw", space: "srgb", channels: 3, depth: "uchar", hasAlpha: false, density: 72 }, { format: "png" }).data;
  const output = sharp(input, {
    filesystem: retained ? filesystem : { readFile: filesystem.readFile.bind(filesystem), writeFile: filesystem.writeFile.bind(filesystem) }
  });
  await output.toFile("/app-icon.uil");
  expect(new TextDecoder().decode(await filesystem.readFile("/app-icon.uil"))).toContain("app_icon_ct : color_table(");
  const text = new TextDecoder().decode(await output.toFormat("uil").toBuffer());
  expect(text).toContain("image_ct : color_table(");
  expect(text).toContain("color('#FF0000FF',background) = ' '");
});

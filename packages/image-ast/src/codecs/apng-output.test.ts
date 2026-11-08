import { expect, it } from "vitest";
import { encodeApngFromStorage, encodeApngImage } from "./apng-output.js";
import type { RgbaImage } from "../ast.js";

it("bounds retained APNG reads and output and honors cancellation", async () => {
  const data = Uint8Array.from({ length: 2051 * 3 * 4 }, (_, i) => (i * 31 + Math.floor(i / 7)) % 256);
  const image: RgbaImage = { width: 2051, height: 3, pageHeight: 1, data, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true, delay: [200, 400, 200], loop: 2 };
  const storage = { allocate() { throw new Error("unexpected allocation"); }, async write() { throw new Error("unexpected write"); }, async read(offset: number, length: number) {
    expect(length).toBeLessThanOrEqual(4096);
    return data.slice(offset, offset + length);
  } };
  const chunks: Uint8Array[] = [];
  const controller = new AbortController();
  for await (const bytes of encodeApngFromStorage({ ...image, position: 0 }, storage, controller.signal, { format: "apng" })) {
    expect(bytes.length).toBeLessThanOrEqual(4096); chunks.push(bytes);
  }
  const result = Buffer.concat(chunks);
  // Chunk boundaries may differ, so compare independently decoded frame pixels via the CLI tests.
  expect(result.subarray(0, 33)).toEqual(Buffer.from(encodeApngImage(image, { format: "apng" }).subarray(0, 33)));
  const iterator = encodeApngFromStorage({ ...image, position: 0 }, storage, controller.signal, { format: "apng" });
  await iterator.next(); controller.abort();
  await expect(iterator.next()).rejects.toThrow();
});

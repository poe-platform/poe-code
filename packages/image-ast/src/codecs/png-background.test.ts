import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodePngImage, readPngMetadata } from "./png.js";
import { encodePngFromStorage } from "./png-storage.js";

for (const stored of [false, true])
it.each(["png24", "png48", "png8", "gray"] as const)(`preserves PNG background metadata for %s, stored=${stored}`, async coder => {
  const backgroundColor = { r: 255, g: 255, b: 255, a: 255 };
  const image: RgbaImage = { width: 1, height: 1, data: Uint8Array.of(255, 255, 255, 255), format: "png", space: coder === "gray" ? "b-w" : "srgb", channels: coder === "gray" ? 1 : 3, depth: "uchar", density: 72, hasAlpha: false, backgroundColor };
  const options = coder === "gray" ? {} : { pngCoder: coder };
  const chunks: Uint8Array[] = [];
  if (stored) {
    const storage = { allocate: vi.fn(), read: vi.fn(async () => image.data), write: vi.fn() };
    for await (const chunk of encodePngFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, options)) chunks.push(chunk);
  } else chunks.push(encodePngImage(image, options));
  expect(readPngMetadata(Buffer.concat(chunks)).backgroundColor).toEqual(backgroundColor);
});

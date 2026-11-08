import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { encodeGifImage } from "./gif.js";
import { encodeGifFromStorage } from "./gif-storage.js";
import type { RgbaImage } from "../ast.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");

it.each([false, true])("decodes local palettes with native libvips, interlace=%s", async gifInterlace => {
  const data = Uint8Array.from({ length: 8 * 8 * 3 * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) % 19) * 12);
  const image: RgbaImage = { width: 8, height: 24, data, format: "gif", space: "srgb", channels: 4, hasAlpha: false, depth: "uchar", density: 72, properties: { comment: "Local palettes" } };
  const options = { globalPalette: false, gifInterlace, pageHeight: 8, delay: 200, loop: 3 };
  const bytes = encodeGifImage(image, options);
  expect(bytes[10]! & 128).toBe(0);
  const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (offset: number, length: number) => data.slice(offset, offset + length)) };
  const chunks: Uint8Array[] = [];
  for await (const chunk of encodeGifFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, options)) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
  const native = sharp(bytes, { animated: true });
  expect(await native.ensureAlpha().raw().toBuffer()).toEqual(Buffer.from(data));
  expect(await native.metadata()).toMatchObject({ pages: 3, delay: [200, 200, 200], loop: 3 });
});

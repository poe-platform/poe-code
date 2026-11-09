import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

export function isXwdBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 7;
}

export function readXwdHeader(bytes: Uint8Array, size = bytes.length) {
  if (!isXwdBytes(bytes) || bytes.length < 100) throw new Error("Invalid XWD header");
  // XWD headers and color records are always big-endian; byte_order applies only to pixels.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(0), depth = view.getUint32(12), width = view.getUint32(16), height = view.getUint32(20);
  const byteOrder = view.getUint32(28), bits = view.getUint32(44), stride = view.getUint32(48), visual = view.getUint32(52), colors = view.getUint32(76);
  if (headerSize < 100 || headerSize > size || !width || !height || !Number.isSafeInteger(width * height * 4)) throw new Error("Invalid XWD dimensions or header size");
  if (view.getUint32(8) !== 2 || view.getUint32(24) !== 0 || byteOrder > 1 || !depth || depth > bits) throw new Error("Unsupported XWD pixel layout");
  const indexed = visual === 3 && bits === 8;
  if (!indexed && !((visual === 4 || visual === 5) && (bits === 24 || bits === 32))) throw new Error("Unsupported XWD visual or pixel depth");
  if (indexed && (!colors || colors > 256)) throw new Error("Invalid XWD palette size");
  if (visual === 5 && colors) throw new Error("Unsupported XWD DirectColor palette");
  const masks = [view.getUint32(56), view.getUint32(60), view.getUint32(64)];
  const scales = indexed ? [] : masks.map(mask => {
    if (!mask || mask >= 2 ** bits) throw new Error("Invalid XWD channel mask");
    let shift = 1;
    while ((mask / shift) % 2 === 0) shift *= 2;
    const max = mask / shift;
    if (!Number.isInteger(Math.log2(max + 1))) throw new Error("Invalid XWD channel mask");
    return { mask, shift, max };
  });
  if (!indexed && ((masks[0]! & masks[1]!) || (masks[0]! & masks[2]!) || (masks[1]! & masks[2]!))) throw new Error("Overlapping XWD channel masks");
  const pixelStart = headerSize + colors * 12, end = pixelStart + stride * height;
  if (stride < width * (bits / 8) || !Number.isSafeInteger(end) || end > size) throw new Error("Truncated XWD pixels or palette");
  const metadata: ImageMetadata = { format: "xwd", width, height, channels: 3, space: "srgb", depth: "uchar", density: 72, hasAlpha: false, size };
  return { metadata, headerSize, pixelStart, stride, bits, byteOrder, indexed, colors, scales };
}

/** Range requests and 1024-pixel blocks share decoding across buffered and retained inputs. */
function* xwdPixels(header: ReturnType<typeof readXwdHeader>): Generator<{ position: number; length: number } | Uint8Array, void, Uint8Array> {
  const { metadata: { width, height }, headerSize, pixelStart, stride, bits, byteOrder, indexed, colors, scales } = header;
  const palette = new Uint8Array(indexed ? 1024 : 0);
  if (indexed) {
    const bytes = yield { position: headerSize, length: colors * 12 };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < colors; i++) {
      const record = i * 12, pixel = view.getUint32(record);
      if (pixel > 255 || palette[pixel * 4 + 3]) throw new Error("Invalid XWD palette pixel ID");
      for (let c = 0; c < 3; c++) palette[pixel * 4 + c] = Math.round(view.getUint16(record + 4 + c * 2) / 257);
      palette[pixel * 4 + 3] = 255;
    }
  }
  const pixelBytes = bits / 8;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 1024) {
    const count = Math.min(1024, width - x), data = new Uint8Array(count * 4);
    const bytes = yield { position: pixelStart + y * stride + x * pixelBytes, length: count * pixelBytes };
    for (let i = 0; i < count; i++) {
      let pixel = 0;
      for (let c = 0; c < pixelBytes; c++) pixel = pixel * 256 + bytes[i * pixelBytes + (byteOrder ? c : pixelBytes - 1 - c)]!;
      if (indexed) {
        if (!palette[pixel * 4 + 3]) throw new Error("Missing XWD palette entry");
        data.set(palette.subarray(pixel * 4, pixel * 4 + 4), i * 4);
      } else {
        for (let c = 0; c < 3; c++) {
          const { mask, shift, max } = scales[c]!;
          data[i * 4 + c] = Math.round(((pixel & mask) >>> 0) / shift * 255 / max);
        }
        data[i * 4 + 3] = 255;
      }
    }
    yield data;
  }
}

export function decodeXwdImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const header = readXwdHeader(bytes), { metadata } = header;
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const data = new Uint8Array(metadata.width * metadata.height * 4), steps = xwdPixels(header);
  let next = steps.next(), offset = 0;
  while (!next.done) {
    if (next.value instanceof Uint8Array) { data.set(next.value, offset); offset += next.value.length; next = steps.next(); }
    else next = steps.next(bytes.subarray(next.value.position, next.value.position + next.value.length));
  }
  return { ...metadata, data };
}

export async function decodeXwdToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const header = readXwdHeader(await source.read(0, Math.min(100, source.size), { signal }), source.size), { metadata } = header;
  signal.throwIfAborted();
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const position = storage.allocate(metadata.width * metadata.height * 4), steps = xwdPixels(header);
  let next = steps.next(), offset = 0;
  while (!next.done) {
    signal.throwIfAborted();
    if (next.value instanceof Uint8Array) {
      await storage.write(position + offset, next.value, { signal }); offset += next.value.length;
      await defaultRuntime.yieldTurn(signal);
      next = steps.next();
    } else {
      const bytes = await source.read(next.value.position, next.value.length, { signal });
      signal.throwIfAborted();
      if (!(bytes instanceof Uint8Array) || bytes.length !== next.value.length) throw new Error("Truncated XWD source");
      next = steps.next(bytes);
    }
  }
  return { ...metadata, position };
}

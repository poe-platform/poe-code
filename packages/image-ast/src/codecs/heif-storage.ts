import { createByteCodec, defaultRuntime, ByteCodecError } from "@poe-code/compression";
import type { ImageMetadata, OutputEncodeOptions, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import { createHeifContainer } from "./heif.js";
import { SourceBytes } from "./storage-source.js";
import { exifMetadataSteps } from "./exif-metadata.js";
import { decodeJpegToStorage } from "./jpeg-input-storage.js";
import {
  decodePngToStorage,
  type ImageByteSource,
  type ImageByteStorage,
  type StoredRgbaImage
} from "./png-storage.js";

import {detectHeifFormatFromSource} from "./heif-format.js";

const windowSize = 4096;
interface Box {
  start: number;
  end: number;
  type: string;
}

/** Fixed-size pages and repeated property scans avoid retaining attacker-sized box tables. */
class HeifSource {
  private readonly bytes: SourceBytes;
  constructor(
    readonly source: ImageByteSource,
    readonly signal: AbortSignal
  ) {
    this.bytes = new SourceBytes(source, signal, "HEIF");
  }
  async uint(position: number, size: number): Promise<number> {
    let result = 0;
    for (let i = 0; i < size; i++) {
      const byte = await this.bytes.at(position + i);
      if (byte === undefined) throw new Error("Truncated HEIF source");
      result = result * 256 + byte;
    }
    return result;
  }
  async ascii(position: number, length: number): Promise<string> {
    let result = "";
    for (let i = 0; i < length; i++)
      result += String.fromCharCode(await this.uint(position + i, 1));
    return result;
  }
  async range(position: number, length: number): Promise<Uint8Array> {
    this.signal.throwIfAborted();
    if (length > windowSize || position < 0 || position + length > this.source.size)
      throw new Error("Truncated HEIF source");
    const bytes = await this.source.read(position, length, { signal: this.signal });
    this.signal.throwIfAborted();
    if (!(bytes instanceof Uint8Array) || bytes.length !== length)
      throw new Error("Truncated HEIF source");
    return bytes.slice();
  }
  async *boxes(start: number, end: number): AsyncGenerator<Box> {
    for (let p = start; p + 8 <= end; ) {
      const size = await this.uint(p, 4),
        type = await this.ascii(p + 4, 4),
        next = size === 0 ? end : p + size;
      if (next > end || next < p + 8) break;
      yield { start: p, end: next, type };
      p = next;
    }
  }
  async *meta(): AsyncGenerator<Box> {
    for await (const box of this.boxes(0, this.source.size))
      if (box.type === "meta") yield* this.boxes(box.start + 12, box.end);
  }
  async *properties(): AsyncGenerator<Box> {
    for await (const box of this.meta())
      if (box.type === "iprp")
        for await (const group of this.boxes(box.start + 8, box.end))
          if (group.type === "ipco") yield* this.boxes(group.start + 8, group.end);
  }
  async associations(primary: number | undefined): Promise<number[] | undefined> {
    if (primary === undefined) return undefined;
    let result: number[] | undefined;
    for await (const box of this.meta())
      if (box.type === "iprp")
        for await (const group of this.boxes(box.start + 8, box.end))
          if (group.type === "ipma" && group.end - group.start >= 16) {
            const version = await this.uint(group.start + 8, 1),
              wide = ((await this.uint(group.start + 9, 3)) & 1) !== 0,
              count = await this.uint(group.start + 12, 4);
            let p = group.start + 16;
            for (let i = 0; i < count && p < group.end; i++) {
              const id = await this.uint(p, version < 1 ? 2 : 4);
              p += version < 1 ? 2 : 4;
              if (p >= group.end) break;
              const n = await this.uint(p++, 1);
              const indices: number[] = [];
              for (let j = 0; j < n && p < group.end; j++) {
                const value = (await this.uint(p, wide ? 2 : 1)) & (wide ? 0x7fff : 0x7f);
                p += wide ? 2 : 1;
                indices.push(value);
              }
              if (id === primary) result = indices;
            }
          }
    return result;
  }
  async *selectedProperties(primary: number | undefined): AsyncGenerator<Box> {
    // The on-wire association count is one byte, so at most 255 indices are retained.
    const indices = await this.associations(primary);
    if (indices === undefined) {
      yield* this.properties();
      return;
    }
    for (const selected of indices) {
      let index = 0;
      for await (const box of this.properties())
        if (++index === selected) {
          yield box;
          break;
        }
    }
  }
}

export async function readHeifMetadataFromSource(
  source: ImageByteSource,
  signal: AbortSignal
): Promise<ImageMetadata> {
  const reader = new HeifSource(source, signal),
    format = await detectHeifFormatFromSource(source,signal);
  if (!format) throw new Error("Invalid HEIF/HEIC/AVIF header");
  let primary: number | undefined,
    compression: "hevc" | "av1" = format === "avif" ? "av1" : "hevc";
  for await (const box of reader.meta())
    if (box.type === "pitm" && box.end - box.start >= 14)
      primary = await reader.uint(
        box.start + 12,
        (await reader.uint(box.start + 8, 1)) === 0 ? 2 : 4
      );
  let width = 0,
    height = 0,
    fallbackWidth = 0,
    fallbackHeight = 0,
    channels: 1 | 2 | 3 | 4 = 3,
    depth: "uchar" | "ushort" = "uchar",
    hasAlpha = false,
    anyAlpha = false,
    orientation: number | undefined,
    density = 72;
  for await (const box of reader.properties()) {
    const size = box.end - box.start;
    if (box.type === "ispe" && size >= 20) {
      const w = await reader.uint(box.start + 12, 4),
        h = await reader.uint(box.start + 16, 4);
      if (w * h > fallbackWidth * fallbackHeight) {
        fallbackWidth = w;
        fallbackHeight = h;
      }
    } else if (box.type === "auxC" && size > 12) {
      let tail = "";
      for (let p = box.start + 12; p < box.end; p++) {
        tail = (tail + (await reader.ascii(p, 1))).slice(-7);
        if (tail.includes("alpha") || tail.includes("auxid:1")) anyAlpha = true;
      }
    } else if (box.type === "av1C") compression = "av1";
    else if (box.type === "hvcC") compression = "hevc";
  }
  for await (const box of reader.selectedProperties(primary)) {
    const size = box.end - box.start;
    if (box.type === "ispe" && size >= 20) {
      const w = await reader.uint(box.start + 12, 4),
        h = await reader.uint(box.start + 16, 4);
      if (w && h && w * h >= width * height) {
        width = w;
        height = h;
      }
    } else if (box.type === "pixi" && size >= 14) {
      const n = await reader.uint(box.start + 12, 1);
      channels = n >= 4 ? 4 : n === 3 ? 3 : n === 2 ? 2 : 1;
      depth = (await reader.uint(box.start + 13, 1)) > 8 ? "ushort" : "uchar";
      if (channels === 4 || channels === 2) hasAlpha = true;
    } else if (box.type === "irot" && size >= 9) {
      const code = (await reader.uint(box.start + 8, 1)) & 3;
      if (code) orientation = [1, 8, 3, 6][code];
    } else if (box.type === "auxC" && size > 12) {
      let tail = "",
        alpha = false;
      for (let p = box.start + 12; p < box.end; p++) {
        tail = (tail + (await reader.ascii(p, 1))).slice(-7);
        if (tail.includes("alpha") || tail.includes("auxid:1")) alpha = true;
      }
      if (alpha) {
        anyAlpha = true;
        hasAlpha = true;
        if (channels === 3) channels = 4;
      }
    } else if (box.type === "av1C") compression = "av1";
    else if (box.type === "hvcC") compression = "hevc";
  }
  if (!hasAlpha && anyAlpha) {
    hasAlpha = true;
    if (channels === 3) channels = 4;
  }
  if (!width || !height) {
    width = fallbackWidth;
    height = fallbackHeight;
  }
  // Iterate items and extents without materializing maps or arbitrary metadata payloads.
  for await (const box of reader.meta())
    if (box.type === "iinf" && box.end - box.start >= 14) {
      const version = await reader.uint(box.start + 8, 1);
      for await (const item of reader.boxes(box.start + (version === 0 ? 14 : 16), box.end))
        if (item.type === "infe" && item.end - item.start >= 20) {
          const v = await reader.uint(item.start + 8, 1);
          if (v < 2) continue;
          const id = await reader.uint(item.start + 12, v === 2 ? 2 : 4),
            type = await reader.ascii(item.start + (v === 2 ? 16 : 18), 4);
          if (type === "av01") compression = "av1";
          else if (type === "hvc1") compression = "hevc";
          if (type !== "Exif") continue;
          for await (const location of reader.meta())
            if (location.type === "iloc" && location.end - location.start >= 16) {
              const start = location.start,
                version = await reader.uint(start + 8, 1),
                b0 = await reader.uint(start + 12, 1),
                b1 = await reader.uint(start + 13, 1),
                count = await reader.uint(start + 14, version < 2 ? 2 : 4);
              let p = start + (version < 2 ? 16 : 18);
              const sized = async (n: number) => {
                if (!n || p + n > location.end) return 0;
                const value = [2, 4, 8].includes(n) ? await reader.uint(p, n) : 0;
                p += n;
                return value;
              };
              for (let i = 0; i < count && p < location.end; i++) {
                const itemId = await sized(version < 2 ? 2 : 4),
                  method = version === 1 || version === 2 ? (await sized(2)) & 15 : 0;
                p += 2;
                const base = await sized(b1 >>> 4),
                  extentCount = await sized(2);
                for (let e = 0; e < extentCount && p < location.end; e++) {
                  if (version === 1 || version === 2) await sized(b1 & 15);
                  const offset = base + (await sized(b0 >>> 4)),
                    length = await sized(b0 & 15);
                  if (itemId !== id || e !== 0 || length <= 8) continue;
                  let baseOffset = 0,
                    limit = source.size;
                  if (method === 1)
                    for await (const data of reader.meta())
                      if (data.type === "idat") {
                        baseOffset = data.start + 8;
                        limit = data.end;
                      }
                  if (baseOffset + offset + length > limit) continue;
                  const start = baseOffset + offset,
                    tiff = await reader.uint(start, 4),
                    skip = 4 + tiff < length ? 4 + tiff : 4;
                  const steps = exifMetadataSteps(length - skip, start + skip);
                  let next = steps.next();
                  while (!next.done)
                    next = steps.next(await reader.range(next.value.position, next.value.length));
                  if (next.value.density !== undefined) density = next.value.density;
                  if (next.value.orientation !== undefined) orientation = next.value.orientation;
                }
              }
            }
        }
    }
  if (width <= 0 || height <= 0) {
    width = 1;
    height = 1;
  }
  return {
    format,
    width,
    height,
    channels,
    space: channels < 3 ? "b-w" : "srgb",
    depth,
    density,
    hasAlpha,
    compression,
    pages: 1,
    pagePrimary: 0,
    size: source.size,
    ...(orientation === undefined ? {} : { orientation })
  };
}

export async function decodeHeifToStorage(
  source: ImageByteSource,
  storage: ImageByteStorage,
  signal: AbortSignal,
  options?: SharpInputOptions
): Promise<StoredRgbaImage> {
  const meta = await readHeifMetadataFromSource(source, signal),
    length = meta.width * meta.height * 4;
  if (!Number.isSafeInteger(length)) throw new RangeError("Invalid HEIF dimensions");
  checkLimitInputPixels(meta.width, meta.height, options);
  const position = storage.allocate(length);
  if (!Number.isSafeInteger(position) || position < 0)
    throw new RangeError("Invalid HEIF backing allocation");
  const reader = new HeifSource(source, signal),
    bytes = new SourceBytes(source, signal, "HEIF");
  let match = 0,
    compressedStart = -1;
  const magic = new TextEncoder().encode("POEHEIF1");
  for (let p = 0; p < source.size; p++) {
    const byte = await bytes.at(p);
    match = byte === magic[match] ? match + 1 : byte === magic[0] ? 1 : 0;
    if (match === magic.length) {
      compressedStart = p + 1;
      break;
    }
  }
  const { size: ignored, ...raster } = meta;
  if (compressedStart >= 0) {
    const codec = createByteCodec({ direction: "decode", format: "zlib", chunkSize: windowSize });
    let written = 0,
      valid = false;
    try {
      for (let p = compressedStart; p < source.size && !codec.complete; p += windowSize) {
        const chunk = await reader.range(p, Math.min(windowSize, source.size - p));
        for (const out of codec.push(chunk, p + chunk.length === source.size)) {
          signal.throwIfAborted();
          const used = Math.min(out.length, length - written);
          if (used > 0) {
            await storage.write(position + written, out.subarray(0, used), { signal });
            written += used;
          }
          await defaultRuntime.yieldTurn(signal);
        }
      }
      valid = codec.complete && written === length;
    } catch (error) {
      if (!(error instanceof ByteCodecError)) throw error;
    } finally {
      codec.close();
    }
    if (valid) return { ...raster, position };
  }
  // Preserve the legacy preview and opaque-black fallback contract.
  for (let p = 16; p + 4 < source.size; p++) {
    const b = await bytes.at(p),
      jpeg = b === 255 && (await bytes.at(p + 1)) === 216 && (await bytes.at(p + 2)) === 255,
      png =
        b === 137 &&
        (await bytes.at(p + 1)) === 80 &&
        (await bytes.at(p + 2)) === 78 &&
        (await bytes.at(p + 3)) === 71;
    if (!jpeg && !png) continue;
    let ioFailed = false;
    const preview = {
      size: source.size - p,
      async read(offset: number, length: number) {
        try {
          return await reader.range(p + offset, length);
        } catch (error) {
          ioFailed = true;
          throw error;
        }
      }
    };
    const backing: ImageByteStorage = {
      allocate(length) {
        try {
          return storage.allocate(length);
        } catch (error) {
          ioFailed = true;
          throw error;
        }
      },
      async read(position, length, options) {
        try {
          return await storage.read(position, length, options);
        } catch (error) {
          ioFailed = true;
          throw error;
        }
      },
      async write(position, bytes, options) {
        try {
          await storage.write(position, bytes, options);
        } catch (error) {
          ioFailed = true;
          throw error;
        }
      }
    };
    try {
      const decoded = await (jpeg ? decodeJpegToStorage : decodePngToStorage)(
        preview,
        backing,
        signal,
        options
      );
      return {
        ...decoded,
        format: meta.format,
        density: meta.density,
        ...(meta.orientation === undefined ? {} : { orientation: meta.orientation })
      };
    } catch (error) {
      signal.throwIfAborted();
      if (ioFailed) throw error;
    }
  }
  const black = new Uint8Array(windowSize);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  for (let p = 0; p < length; p += windowSize) {
    signal.throwIfAborted();
    await storage.write(position + p, black.subarray(0, Math.min(windowSize, length - p)), {
      signal
    });
    await defaultRuntime.yieldTurn(signal);
  }
  return { ...raster, position };
}

/** The sizing pass avoids retaining compressed output or introducing private scratch storage. */
export async function* encodeHeifFromStorage(
  image: StoredRgbaImage,
  storage: ImageByteStorage,
  signal: AbortSignal,
  options: OutputEncodeOptions = {}
): AsyncGenerator<Uint8Array> {
  const length = image.width * image.height * 4;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    !Number.isSafeInteger(image.position) ||
    image.position < 0
  )
    throw new RangeError("Invalid HEIF backing dimensions");
  async function* compressed() {
    const codec = createByteCodec({
      direction: "encode",
      format: "zlib",
      level: 6,
      chunkSize: windowSize
    });
    try {
      for (let p = 0; p < length; p += windowSize) {
        signal.throwIfAborted();
        const n = Math.min(windowSize, length - p),
          bytes = await storage.read(image.position + p, n, { signal });
        signal.throwIfAborted();
        if (!(bytes instanceof Uint8Array) || bytes.length !== n)
          throw new Error("Truncated HEIF backing storage");
        yield* codec.push(bytes);
        await defaultRuntime.yieldTurn(signal);
      }
      signal.throwIfAborted();
      yield* codec.push(new Uint8Array(), true);
    } finally {
      codec.close();
    }
  }
  let size = 0;
  for await (const bytes of compressed()) size += bytes.length;
  const format = options.format === "avif" ? "avif" : options.format === "heif" ? "heif" : "heic";
  const { header, suffix } = createHeifContainer(image, size, { ...options, format });
  yield header;
  yield* compressed();
  signal.throwIfAborted();
  yield suffix;
}

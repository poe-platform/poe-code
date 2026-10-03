import {createImageDelayReader} from "./stored-delay.js";
import {scanGifAnimation} from "./gif-metadata-storage.js";
import { defaultRuntime } from "@poe-code/compression";
import type { SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { isGifBytes } from "./gif.js";

/** Decode GIF subblocks with fixed 12-bit dictionary state. */
async function* indices(
  reader: SourceBytes,
  start: number,
  size: number,
  minimum: number,
  count: number
) {
  const clear = 1 << minimum,
    eoi = clear + 1,
    prefix = new Int32Array(4096),
    suffix = new Uint8Array(4096),
    stack = new Uint8Array(4096);
  for (let i = 0; i < Math.min(clear, 4096); i++) {
    prefix[i] = -1;
    suffix[i] = i;
  }
  let position = start,
    left = 0,
    ended = false,
    buffer = 0,
    bits = 0,
    width = minimum + 1,
    next = eoi + 1,
    old = -1,
    first = 0,
    written = 0;
  const byte = async () => {
    if (ended) return undefined;
    if (left === 0) {
      left = (await reader.at(position++)) ?? 0;
      if (left === 0) {
        ended = true;
        return undefined;
      }
    }
    if (position >= size) {
      ended = true;
      return undefined;
    }
    left--;
    return reader.at(position++);
  };
  const code = async () => {
    while (bits < width) {
      const value = await byte();
      if (value === undefined) return eoi;
      buffer |= value << bits;
      bits += 8;
    }
    const value = buffer & ((1 << width) - 1);
    buffer >>>= width;
    bits -= width;
    return value;
  };
  while (written < count) {
    const value = await code();
    if (value === eoi) break;
    if (value === clear) {
      width = minimum + 1;
      next = eoi + 1;
      old = -1;
      continue;
    }
    let current = value,
      used = 0;
    if (value >= next) {
      stack[used++] = first;
      current = old;
    }
    while (current >= clear && current >= 0) {
      if (used >= 4096) throw new Error("Invalid GIF LZW dictionary");
      stack[used++] = suffix[current]!;
      current = prefix[current]!;
    }
    if (current < 0) break;
    first = suffix[current]!;
    stack[used++] = first;
    while (used > 0 && written < count) {
      yield stack[--used] ?? 0;
      written++;
    }
    if (old !== -1 && next < 4096) {
      prefix[next] = old;
      suffix[next] = first;
      next++;
      if (next === 1 << width && width < 12) width++;
    }
    old = value;
  }
  while (written++ < count) yield 0;
}

/** Retained GIF input uses bounded pages and reusable caller-backed canvases. */
export async function decodeGifToStorage(
  source: ImageByteSource,
  storage: ImageByteStorage,
  signal: AbortSignal,
  options?: SharpInputOptions
): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const reader = new SourceBytes(source, signal, "GIF"),
    header = new Uint8Array(Math.min(source.size, 13));
  for (let i = 0; i < header.length; i++) header[i] = (await reader.at(i)) ?? 0;
  if (!isGifBytes(header) || header.length < 13) throw new Error("Invalid GIF header");
  const width = header[6]! | (header[7]! << 8),
    height = header[8]! | (header[9]! << 8),
    frameBytes = width * height * 4;
  checkLimitInputPixels(width, height, options);
  const word = async (at: number) =>
    ((await reader.at(at)) ?? 0) | (((await reader.at(at + 1)) ?? 0) << 8);
  const start = 13 + (header[10]! & 128 ? 3 * (1 << ((header[10]! & 7) + 1)) : 0);
  const skip = async (at: number) => {
    while (at < source.size) {
      const length = (await reader.at(at++)) ?? 0;
      if (!length) break;
      at += length;
    }
    return at;
  };
  const {frames,loop}=await scanGifAnimation(reader,source.size,start);
  const totalPages = Math.max(1, frames),
    multi =
      options?.animated === true ||
      options?.pages === -1 ||
      (options?.pages !== undefined && options.pages > 1),
    page = Math.max(0, options?.page ?? 0),
    pages = multi
      ? options?.pages !== undefined && options.pages > 0
        ? Math.min(options.pages, Math.max(1, totalPages - page))
        : Math.max(1, totalPages - page)
      : 1,
    end = page + pages - 1;
  if (!Number.isSafeInteger(frameBytes * pages)) throw new RangeError("Invalid GIF dimensions");
  checkLimitInputPixels(width, height * pages, options);
  const allocate = (length: number) => {
    const at = storage.allocate(length);
    if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(at + length))
      throw new RangeError("Invalid GIF backing allocation");
    return at;
  };
  const write = async (at: number, bytes: Uint8Array) => {
    signal.throwIfAborted();
    await storage.write(at, bytes, { signal });
    signal.throwIfAborted();
  };
  const read = async (at: number, length: number, readSignal = signal) => {
    readSignal.throwIfAborted();
    const bytes = await storage.read(at, length, { signal: readSignal });
    readSignal.throwIfAborted();
    if (!(bytes instanceof Uint8Array) || bytes.length !== length)
      throw new Error("Truncated GIF backing storage");
    return new Uint8Array(bytes);
  };
  const delayPosition = allocate(frames * 4),
    delayBytes = new Uint8Array(4),
    delayView = new DataView(delayBytes.buffer);
  if (frames)
    await scanGifAnimation(reader,source.size,start,async (frame, delay) => {
      delayView.setUint32(0, delay, true);
      await write(delayPosition + frame * 4, delayBytes);
    });
  const canvas = allocate(frameBytes),
    saved = allocate(frameBytes),
    output = pages > 1 ? allocate(frameBytes * pages) : canvas,
    zeros = new Uint8Array(4096);
  const clear = async (at: number, length: number) => {
    for (let i = 0; i < length; i += 4096) {
      await write(at + i, zeros.subarray(0, Math.min(4096, length - i)));
      await defaultRuntime.yieldTurn(signal);
    }
  };
  const copy = async (from: number, to: number) => {
    for (let i = 0; i < frameBytes; i += 4096) {
      await write(to + i, await read(from + i, Math.min(4096, frameBytes - i)));
      await defaultRuntime.yieldTurn(signal);
    }
  };
  await clear(canvas, frameBytes);
  if (pages > 1) await clear(output, frameBytes * pages);
  let cacheAt = -1,
    cache = new Uint8Array(0),
    dirty = false;
  const flush = async () => {
    if (dirty) {
      await write(canvas + cacheAt, cache);
      dirty = false;
    }
  };
  const pixel = async (index: number, color?: number) => {
    const offset = index * 4,
      at = Math.floor(offset / 4096) * 4096;
    if (at !== cacheAt) {
      await flush();
      cache = await read(canvas + at, Math.min(4096, frameBytes - at));
      cacheAt = at;
    }
    const local = offset - at;
    if (color !== undefined) {
      cache[local] = color & 255;
      cache[local + 1] = (color >>> 8) & 255;
      cache[local + 2] = (color >>> 16) & 255;
      cache[local + 3] = color >>> 24;
      dirty = true;
    }
    return cache[local + 3]!;
  };
  const palette = async (at: number, length: number) => {
    const bytes = new Uint8Array(Math.min(length, Math.max(0, source.size - at)));
    for (let i = 0; i < bytes.length; i++) bytes[i] = (await reader.at(at + i)) ?? 0;
    return bytes;
  };
  const global = await palette(13, start - 13);
  let at = start,
    transparent = -1,
    disposal = 0,
    current = 0,
    hasAlpha = false,
    work = 0;
  while (at < source.size) {
    const intro = await reader.at(at++);
    if (intro === 59) break;
    if (intro === 33) {
      const label = await reader.at(at++);
      if (label === 249) {
        const length = await reader.at(at++),
          flags = (await reader.at(at)) ?? 0;
        disposal = (flags >>> 2) & 7;
        transparent = flags & 1 ? ((await reader.at(at + 3)) ?? -1) : -1;
        at += (length ?? Number.NaN) + 1;
      } else at = await skip(at);
    } else if (intro === 44) {
      const left = await word(at),
        top = await word(at + 2),
        w = await word(at + 4),
        h = await word(at + 6),
        flags = (await reader.at(at + 8)) ?? 0;
      at += 9;
      let colors = global;
      if (flags & 128) {
        const length = 3 * (1 << ((flags & 7) + 1));
        colors = await palette(at, length);
        at += length;
      }
      const minimum = (await reader.at(at++)) ?? 0,
        data = at;
      at = await skip(at);
      await flush();
      if (disposal === 3) await copy(canvas, saved);
      let x = 0,
        y = 0,
        pass = 0;
      const starts = [0, 4, 2, 1],
        steps = [8, 8, 4, 2];
      for await (const index of indices(reader, data, source.size, minimum, w * h)) {
        signal.throwIfAborted();
        if (++work % 16384 === 0) await defaultRuntime.yieldTurn(signal);
        const dx = left + x,
          dy = top + y;
        if (dx < width && dy < height) {
          if (index === transparent) {
            if (current === 0) await pixel(dy * width + dx, 0);
          } else
            await pixel(
              dy * width + dx,
              (colors[index * 3] ?? 0) |
                ((colors[index * 3 + 1] ?? 0) << 8) |
                ((colors[index * 3 + 2] ?? 0) << 16) |
                (255 << 24)
            );
        }
        if (++x === w) {
          x = 0;
          if (flags & 64) {
            y += steps[pass]!;
            while (y >= h && pass < 3) {
              pass++;
              y = starts[pass]!;
            }
          } else y++;
        }
      }
      await flush();
      if (transparent !== -1) hasAlpha = true;
      if (current >= page && current <= end && pages > 1)
        await copy(canvas, output + (current - page) * frameBytes);
      if (current >= end) break;
      if (disposal === 2) {
        for (let y = 0; y < h; y++) {
          if (top + y >= height) continue;
          for (let x = 0; x < w && left + x < width; x++) {
            await pixel((top + y) * width + left + x, 0);
            if (++work % 16384 === 0) await defaultRuntime.yieldTurn(signal);
          }
        }
        await flush();
      } else if (disposal === 3) {
        await copy(saved, canvas);
        cacheAt = -1;
        cache = new Uint8Array(0);
      }
      current++;
      transparent = -1;
      disposal = 0;
    } else break;
  }
  await flush();
  if (!hasAlpha)
    for (let i = 0; i < frameBytes * pages && !hasAlpha; i += 4096) {
      const bytes = await read(output + i, Math.min(4096, frameBytes * pages - i));
      for (let j = 3; j < bytes.length; j += 4)
        if (bytes[j]! < 255) {
          hasAlpha = true;
          break;
        }
      await defaultRuntime.yieldTurn(signal);
    }
  return {
    width,
    height: height * pages,
    position: output,
    format: "gif",
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density: 72,
    hasAlpha,
    ...(pages > 1 ? { pages, sourcePages: totalPages, pageHeight: height } : {}),
    ...(frames
      ? {
          storedDelay:createImageDelayReader(storage,delayPosition,frames,signal)
        }
      : {}),
    ...(loop !== undefined ? { loop } : totalPages > 1 ? { loop: 0 } : {})
  };
}

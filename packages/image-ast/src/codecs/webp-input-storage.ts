import {webpMetadataSteps} from "./webp-metadata.js";
import { createByteCodec, defaultRuntime } from "@poe-code/compression";
import type { SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { BackingArena } from "./backing-arena.js";
import { decodeWebpLossless, type Vector } from "./webp-decode-kernel.js";

class Words {
  readonly arena: BackingArena;
  private readonly pages = new Map<number, { bytes: Uint8Array; view: DataView; dirty: boolean }>();
  private end = 0;
  constructor(
    storage: ImageByteStorage,
    readonly signal: AbortSignal
  ) {
    this.arena = new BackingArena(storage);
  }
  private async flush(page: number) {
    const value = this.pages.get(page)!;
    if (value.dirty) {
      await this.arena.write(page * 4096, value.bytes, { signal: this.signal });
      this.signal.throwIfAborted();
      value.dirty = false;
    }
  }
  async allocate(length: number) {
    if (this.end % 4096) {
      const page = Math.floor(this.end / 4096);
      if (this.pages.has(page)) {
        await this.flush(page);
        this.pages.delete(page);
      }
    }
    const position = this.arena.allocate(length);
    this.end = position + length;
    const zero = new Uint8Array(4096);
    for (let at = 0; at < length; at += 4096) {
      this.signal.throwIfAborted();
      await this.arena.write(position + at, zero.subarray(0, Math.min(4096, length - at)), {
        signal: this.signal
      });
      if (at % 65536 === 0) await defaultRuntime.yieldTurn(this.signal);
    }
    return position;
  }
  async page(position: number) {
    const index = Math.floor(position / 4096);
    let page = this.pages.get(index);
    if (!page) {
      if (this.pages.size === 32) {
        const key = this.pages.keys().next().value!;
        await this.flush(key);
        this.pages.delete(key);
      }
      const bytes = await this.arena.read(index * 4096, Math.min(4096, this.end - index * 4096), {
        signal: this.signal
      });
      page = {
        bytes,
        view: new DataView(bytes.buffer, bytes.byteOffset, bytes.length),
        dirty: false
      };
      this.pages.set(index, page);
    }
    return page;
  }
  cached(position: number) {
    return this.pages.get(Math.floor(position / 4096));
  }
  async word(position: number) {
    const page = this.cached(position) ?? (await this.page(position));
    return page.view.getFloat64(position % 4096, true);
  }
  async decode(
    source: ImageByteSource,
    start: number,
    length: number,
    width: number,
    height: number
  ): Promise<Vector | undefined> {
    // Zero is the kernel's absent-node sentinel, never a live backing address.
    if (!this.end) await this.allocate(8);
    const kernel = decodeWebpLossless(start, length, width, height);
    let value = 0,
      work = 0,
      sourcePage = -1,
      sourceBytes = new Uint8Array();
    while (true) {
      this.signal.throwIfAborted();
      let step;
      try {
        step = kernel.next(value);
      } catch {
        return undefined;
      }
      if (step.done) return step.value;
      const effect = step.value;
      if (effect.kind === "allocate") value = await this.allocate(effect.length);
      else if (effect.kind === "byte") {
        const page = Math.floor(effect.position / 4096);
        if (page !== sourcePage) {
          const size = Math.min(4096, source.size - page * 4096),
            input = await source.read(page * 4096, size, { signal: this.signal });
          this.signal.throwIfAborted();
          if (!(input instanceof Uint8Array) || input.length !== size)
            throw new Error("Truncated WebP source");
          sourceBytes = new Uint8Array(input);
          sourcePage = page;
        }
        value = sourceBytes[effect.position % 4096]!;
      } else {
        const page = this.cached(effect.position) ?? (await this.page(effect.position)),
          offset = effect.position % 4096;
        if (effect.kind === "get") value = page.view.getFloat64(offset, true);
        else {
          page.view.setFloat64(offset, effect.value, true);
          page.dirty = true;
          value = 0;
        }
      }
      if (++work % 65536 === 0) await defaultRuntime.yieldTurn(this.signal);
    }
  }
}

/** Retained RIFF tags and VP8L data use only caller-owned storage and bounded pages. */
/** Scan RIFF headers and offset EXIF fields through one owned input page. */
export async function readWebpMetadataFromSource(source:ImageByteSource,signal:AbortSignal) {
  signal.throwIfAborted();
  const reader=new SourceBytes(source,signal,"WebP"),steps=webpMetadataSteps(source.size);let next=steps.next();
  while(!next.done) {
    const {position,length}=next.value,bytes=new Uint8Array(length);
    for(let i=0;i<length;i++)bytes[i]=await reader.at(position+i)??0;
    next=steps.next(bytes);
  }
  signal.throwIfAborted();return next.value;
}

export async function decodeWebpToStorage(
  source: ImageByteSource,
  storage: ImageByteStorage,
  signal: AbortSignal,
  options?: SharpInputOptions
): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const reader = new SourceBytes(source, signal, "WebP");
  const byte = async (at: number) => (await reader.at(at)) ?? 0;
  const number = async (at: number, size: number, le = true) => {
    let value = 0;
    for (let i = 0; i < size; i++)
      value += (await byte(at + i)) * 2 ** ((le ? i : size - i - 1) * 8);
    return value;
  };
  const fourcc = async (at: number) =>
    String.fromCharCode(await byte(at), await byte(at + 1), await byte(at + 2), await byte(at + 3));
  const {width,height,hasAlpha,density,orientation}=await readWebpMetadataFromSource(source,signal);
  checkLimitInputPixels(width, height, options);
  const size = width * height * 4,
    position = storage.allocate(size);
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + size))
    throw new RangeError("Invalid WebP backing allocation");
  const write = async (at: number, bytes: Uint8Array) => {
    signal.throwIfAborted();
    await storage.write(position + at, bytes, { signal });
    signal.throwIfAborted();
  };
  const metadata = {
    width,
    height,
    position,
    format: "webp" as const,
    space: "srgb" as const,
    channels: hasAlpha ? (4 as const) : (3 as const),
    depth: "uchar" as const,
    density,
    hasAlpha
  };
  for (let at = 12; at + 8 <= source.size; ) {
    const kind = await fourcc(at),
      length = await number(at + 4, 4),
      start = at + 8;
    if (start + length > source.size) break;
    if (kind === "VP8L" && length >= 5 && (await byte(start)) === 47) {
      if (length > 7 && (await byte(start + 5)) === 0 && (await byte(start + 6)) === 120) {
        const codec = createByteCodec({ direction: "decode", format: "zlib", chunkSize: 4096 });
        let written = 0,
          invalid = false;
        try {
          for (let off = 6; off < length && !codec.complete; off += 4096) {
            const count = Math.min(4096, length - off),
              input = await source.read(start + off, count, { signal });
            signal.throwIfAborted();
            if (!(input instanceof Uint8Array) || input.length !== count)
              throw new Error("Truncated WebP source");
            const iterator = codec.push(new Uint8Array(input), off + count === length);
            while (true) {
              let next;
              try {
                next = iterator.next();
              } catch {
                invalid = true;
                break;
              }
              if (next.done) break;
              const n = Math.min(next.value.length, size - written);
              if (n > 0) await write(written, next.value.subarray(0, n));
              written += next.value.length;
              await defaultRuntime.yieldTurn(signal);
            }
            if (invalid) break;
          }
        } finally {
          codec.close();
        }
        if (!invalid && written === size)
          return { ...metadata, ...(orientation === undefined ? {} : { orientation }) };
      }
      const words = new Words(storage, signal),
        pixels = await words.decode(source, start, length, width, height);
      if (pixels) {
        for (let off = 0; off < size; off += 4096) {
          const bytes = new Uint8Array(Math.min(4096, size - off));
          for (let i = 0; i < bytes.length; i += 4) {
            const p =
              (off + i) / 4 < pixels.length ? await words.word(pixels.position + (off + i) * 2) : 0;
            bytes[i] = p >>> 16;
            bytes[i + 1] = p >>> 8;
            bytes[i + 2] = p;
            bytes[i + 3] = p >>> 24;
          }
          await write(off, bytes);
          if (off % 65536 === 0) await defaultRuntime.yieldTurn(signal);
        }
        return { ...metadata, ...(orientation === undefined ? {} : { orientation }) };
      }
    }
    at = start + length + (length & 1);
  }
  const black = new Uint8Array(4096);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  for (let at = 0; at < size; at += 4096) {
    await write(at, black.subarray(0, Math.min(4096, size - at)));
    if (at % 65536 === 0) await defaultRuntime.yieldTurn(signal);
  }
  return metadata;
}

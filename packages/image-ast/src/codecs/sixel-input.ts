import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { defaultRuntime } from "@poe-code/compression";

export function isSixelBytes(bytes: Uint8Array): boolean {
  let i = bytes[0] === 0x90 ? 1 : bytes[0] === 27 && bytes[1] === 80 ? 2 : -1;
  if (i < 0) return false;
  while (i < bytes.length && ((bytes[i]! >= 48 && bytes[i]! <= 57) || bytes[i] === 59)) i++;
  return bytes[i] === 113;
}

function defaultPalette(): Uint8Array {
  const palette = new Uint8Array(1024 * 4);
  const colors = [[0,0,0],[20,20,80],[80,13,13],[20,80,20],[80,20,80],[20,80,80],[80,80,20],[53,53,53],
    [26,26,26],[33,33,60],[60,26,26],[33,60,33],[60,33,60],[33,60,60],[60,60,33],[80,80,80]];
  for (let i = 0; i < 1024; i++) {
    const rgb = i < 16 ? colors[i]!.map(v => Math.round(v * 255 / 100)) : i < 232
      ? [Math.floor((i - 16) / 36) * 51, Math.floor((i - 16) / 6) % 6 * 51, (i - 16) % 6 * 51]
      : Array<number>(3).fill(i < 256 ? (i - 232) * 11 : 255);
    palette.set([...rgb, 255], i * 4);
  }
  return palette;
}

function hls(hue: number, lightness: number, saturation: number): number[] {
  if (!saturation) return Array<number>(3).fill(Math.trunc(lightness * 255 / 100));
  const upper = lightness <= 50 ? Math.trunc((lightness * (100 + saturation) + 50) / 100)
    : lightness + saturation - Math.trunc((lightness * saturation + 50) / 100);
  const lower = 2 * lightness - upper;
  return [0, -33, 33].map(offset => {
    let h = Math.trunc(hue * 100 / 360) + offset;
    if (h < 0) h += 100;
    if (h > 100) h -= 100;
    const value = h < 16 ? lower + Math.trunc(((upper - lower) * h + 8) / 16)
      : h < 50 ? upper : h < 66 ? lower + Math.trunc(((upper - lower) * (66 - h) + 8) / 16) : lower;
    return Math.trunc((value * 255 + 50) / 100);
  });
}

type Run = { x: number; y: number; count: number; bits: number; color: number };
type Layout = { metadata: ImageMetadata; palette: Uint8Array };

// Scan before allocating: raster attributes are minimum dimensions, while painted
// pixels can extend them. A final palette definition also applies to earlier pixels.
function* sixelSteps(size: number, options?: SharpInputOptions, paint = false): Generator<number | Run, Layout, number | undefined> {
  let offset = 0;
  function* byte(): Generator<number, number, number | undefined> {
    if (offset >= size) throw new Error("Truncated SIXEL data");
    const value = yield offset++;
    if (value === undefined) throw new Error("Truncated SIXEL data");
    return value;
  }
  let c = yield* byte();
  if (c === 27) { if ((yield* byte()) !== 80) throw new Error("Invalid SIXEL header"); }
  else if (c !== 0x90) throw new Error("Invalid SIXEL header");
  c = yield* byte();
  function* params(): Generator<number, number[], number | undefined> {
    const values: number[] = [];
    while ((c >= 48 && c <= 57) || c === 59) {
      let value = 0;
      while (c >= 48 && c <= 57) {
        value = value * 10 + c - 48;
        if (value > 0x7fffffff) throw new Error("Invalid SIXEL parameter");
        c = yield* byte();
      }
      values.push(value);
      if (values.length > 5) throw new Error("Invalid SIXEL parameters");
      if (c !== 59) break;
      c = yield* byte();
    }
    return values;
  }
  yield* params();
  if (c !== 113) throw new Error("Invalid SIXEL header");
  let x = 0, y = 0, width = 1, height = 1, color = 0, transparent = -1;
  const palette = defaultPalette();
  function dimensions() {
    if (!Number.isSafeInteger(width * height * 4) || width * height * 4 > 0xffffffff) throw new Error("Invalid SIXEL dimensions");
    checkLimitInputPixels(width, height, options);
  }
  c = yield* byte();
  while (c !== 0x9c) {
    if (c === 27) {
      if ((yield* byte()) !== 92) throw new Error("Invalid SIXEL terminator");
      break;
    }
    if (c === 34 || c === 35) {
      const command = c;
      c = yield* byte();
      const values = yield* params();
      if (command === 34) {
        if (values.length < 2 || values.length > 4) throw new Error("Invalid SIXEL raster attributes");
        width = Math.max(width, values[2] ?? 0); height = Math.max(height, values[3] ?? 0);
        dimensions();
      } else {
        if ((values.length !== 1 && values.length !== 5) || values[0]! >= 1024) throw new Error("Invalid SIXEL color");
        color = values[0]!;
        if (values.length === 5) {
          const [, mode, a, b, d] = values as [number, number, number, number, number];
          if (mode !== 1 && mode !== 2) throw new Error("Unsupported SIXEL color space");
          // ImageMagick's SIXEL reader uses the last black RGB definition as its transparent index.
          if (mode === 2 && a === 0 && b === 0 && d === 0) transparent = color;
          else palette.set(mode === 1 ? hls(Math.min(a, 360), Math.min(b, 100), Math.min(d, 100))
            : [a, b, d].map(v => Math.round(Math.min(v, 100) * 255 / 100)), color * 4);
        }
      }
      continue;
    }
    let count = 1;
    if (c === 33) {
      c = yield* byte();
      const values = yield* params();
      if (values.length !== 1 || values[0] === 0 || c < 63 || c > 126) throw new Error("Invalid SIXEL repeat");
      count = values[0]!;
    }
    if (c >= 63 && c <= 126) {
      const bits = c - 63;
      if (!Number.isSafeInteger(x + count)) throw new Error("Invalid SIXEL dimensions");
      if (bits) {
        width = Math.max(width, x + count);
        height = Math.max(height, y + 32 - Math.clz32(bits));
        dimensions();
        if (paint) yield { x, y, count, bits, color };
      }
      x += count;
    } else if (c === 36) x = 0;
    else if (c === 45) { x = 0; y += 6; }
    else if (c !== 10 && c !== 13 && c !== 9 && c !== 32) throw new Error("Invalid SIXEL command");
    c = yield* byte();
  }
  if (transparent >= 0) palette[transparent * 4 + 3] = 0;
  dimensions();
  return { metadata: { format: "sixel", width, height, channels: transparent >= 0 ? 4 : 3, space: "srgb", depth: "uchar",
    density: 72, hasAlpha: transparent >= 0, size }, palette };
}

function readLayout(bytes: Uint8Array, options?: SharpInputOptions): Layout {
  const steps = sixelSteps(bytes.length, options);
  let next = steps.next();
  while (!next.done) next = steps.next(bytes[next.value as number]);
  return next.value;
}

export function readSixelMetadata(bytes: Uint8Array, options?: SharpInputOptions): ImageMetadata {
  return readLayout(bytes, options).metadata;
}

export async function readSixelFromSource(source: ImageByteSource, signal: AbortSignal, options?: SharpInputOptions): Promise<Layout> {
  const reader = new SourceBytes(source, signal, "SIXEL"), steps = sixelSteps(source.size, options);
  let next = steps.next();
  while (!next.done) next = steps.next(await reader.at(next.value as number));
  return next.value;
}

function* sixelPixels(layout: Layout, size: number): Generator<number | { offset: number; data: Uint8Array }, void, number | undefined> {
  const { metadata: { width, height }, palette } = layout;
  const block = new Uint8Array(4096);
  for (let i = 0; i < block.length; i += 4) block.set(palette.subarray(0, 4), i);
  for (let offset = 0; offset < width * height * 4; offset += block.length) {
    yield { offset, data: block.subarray(0, Math.min(block.length, width * height * 4 - offset)) };
  }
  const steps = sixelSteps(size, undefined, true);
  let next = steps.next();
  while (!next.done) {
    if (typeof next.value === "number") next = steps.next(yield next.value);
    else {
      const { x, y, count, bits, color } = next.value;
      for (let i = 0; i < block.length; i += 4) block.set(palette.subarray(color * 4, color * 4 + 4), i);
      for (let row = 0; row < 6; row++) if (bits & (1 << row)) {
        for (let column = 0; column < count; column += 1024) {
          yield { offset: ((y + row) * width + x + column) * 4, data: block.subarray(0, Math.min(1024, count - column) * 4) };
        }
      }
      next = steps.next();
    }
  }
}

export function decodeSixelImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const layout = readLayout(bytes, options), { metadata } = layout;
  const data = new Uint8Array(metadata.width * metadata.height * 4), steps = sixelPixels(layout, bytes.length);
  let next = steps.next();
  while (!next.done) {
    if (typeof next.value === "number") next = steps.next(bytes[next.value]);
    else { data.set(next.value.data, next.value.offset); next = steps.next(); }
  }
  return { ...metadata, data };
}

export async function decodeSixelToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const layout = await readSixelFromSource(source, signal, options), { metadata } = layout;
  const position = storage.allocate(metadata.width * metadata.height * 4), reader = new SourceBytes(source, signal, "SIXEL");
  const steps = sixelPixels(layout, source.size);
  let next = steps.next();
  while (!next.done) {
    if (typeof next.value === "number") next = steps.next(await reader.at(next.value));
    else {
      await defaultRuntime.yieldTurn(signal);
      signal.throwIfAborted();
      await storage.write(position + next.value.offset, next.value.data, { signal });
      next = steps.next();
    }
  }
  return { ...metadata, position };
}

import { parseColor, type ImageMetadata, type RgbaImage, type SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { XPM_COLORS } from "./xpm-colors.js";

export function isXpmBytes(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 9)) === "/* XPM */";
}

type Step = { kind: "read"; position: number } | { kind: "header"; metadata: ImageMetadata } | { kind: "pixel"; values: number[] };
function* xpmSteps(size: number, options?: SharpInputOptions): Generator<Step, ImageMetadata, number | undefined> {
  let position = 9;
  function* string(limit: number): Generator<Step, string, number | undefined> {
    let comment = false, previous = 0;
    while (position < size) {
      const byte = yield { kind: "read", position: position++ };
      if (comment) { if (previous === 42 && byte === 47) { comment = false; previous = 0; } else previous = byte ?? 0; continue; }
      if (previous === 47 && byte === 42) { comment = true; previous = 0; continue; }
      if (byte === 34) {
        let value = "";
        while (position < size) {
          let char = yield { kind: "read", position: position++ };
          if (char === 34) return value;
          if (char === 92) {
            char = yield { kind: "read", position: position++ };
            if (char !== 92 && char !== 34) throw new Error("Unsupported XPM string escape");
          }
          if (char === undefined || (char < 32 && char !== 9) || value.length >= limit) throw new Error("Invalid XPM string");
          value += String.fromCharCode(char);
        }
      }
      previous = byte ?? 0;
    }
    throw new Error("Truncated XPM input");
  }
  const words = (value: string): string[] => value.split(" ").flatMap(part => part.split("\t")).filter(Boolean);
  const [width, height, colors, cpp] = words(yield* string(256)).slice(0, 4).map(Number);
  if (![width, height, colors, cpp].every(value => value !== undefined && Number.isSafeInteger(value) && value > 0) || !width || !height || !colors || !cpp || colors > 65536 || cpp > 8 || !Number.isSafeInteger(width * height * 4) || width * height * cpp > size) throw new Error("Invalid XPM header");
  checkLimitInputPixels(width, height, options);
  if (options?.page) throw new Error("XPM page is out of range");
  const palette = new Map<string, number[]>();
  let hasAlpha = false, highDepth = false;
  for (let i = 0; i < colors; i++) {
    const line = yield* string(4096), symbol = line.slice(0, cpp), fields = words(line.slice(cpp));
    const keys = ["c", "g", "g4", "m", "s"];
    const values = new Map<string, string>();
    for (let j = 0; j < fields.length;) {
      const key = fields[j++]!, start = j;
      while (j < fields.length && !keys.includes(fields[j]!)) j++;
      values.set(key, fields.slice(start, j).join(" "));
    }
    const color = values.get("c") ?? values.get("g") ?? values.get("g4") ?? values.get("m") ?? values.get("s");
    if (!color || symbol.length !== cpp || palette.has(symbol)) throw new Error("Invalid XPM palette");
    let rgba: number[];
    if (color.toLowerCase() === "none") { rgba = [0, 0, 0, 0]; hasAlpha = true; }
    else if (color.startsWith("#")) {
      const hex = color.slice(1).toLowerCase(), digits = hex.length / 3;
      if (![1, 2, 3, 4].includes(digits) || [...hex].some(char => !"0123456789abcdef".includes(char))) throw new Error("Invalid XPM color");
      rgba = [0, 1, 2].map(channel => Math.round(parseInt(hex.slice(channel * digits, (channel + 1) * digits), 16) * 65535 / (16 ** digits - 1)));
      rgba.push(65535);
      highDepth ||= digits > 2;
    } else if (color.includes("(")) {
      const { r, g, b, a } = parseColor(color); rgba = [r, g, b, a].map(value => value * 257);
    } else {
      // Native XPM replaces lowercase "grey" before its case-insensitive lookup.
      const name = color.replaceAll("grey", "gray").toLowerCase().split(" ").join("");
      if (!Object.hasOwn(XPM_COLORS, name)) throw new Error("Invalid XPM color");
      const rgb = XPM_COLORS[name]!;
      rgba = [rgb >>> 16, (rgb >>> 8) & 255, rgb & 255, 255].map(value => value * 257);
    }
    palette.set(symbol, rgba);
  }
  const metadata: ImageMetadata = { format: "xpm", width, height, channels: hasAlpha ? 4 : 3, hasAlpha, space: "srgb", depth: highDepth ? "ushort" : "uchar", density: 72, size };
  yield { kind: "header", metadata };
  for (let y = 0; y < height; y++) {
    const row = yield* string(width * cpp);
    if (row.length !== width * cpp) throw new Error("Invalid XPM row length");
    for (let x = 0; x < width; x++) {
      const values = palette.get(row.slice(x * cpp, (x + 1) * cpp));
      if (!values) throw new Error("Unknown XPM pixel symbol");
      yield { kind: "pixel", values };
    }
  }
  return metadata;
}

export function readXpmImage(bytes: Uint8Array, options?: SharpInputOptions, metadataOnly = false): RgbaImage {
  const steps = xpmSteps(bytes.length, options);
  let next = steps.next(), data = new Uint8Array(), offset = 0;
  let data16: Uint16Array | undefined;
  while (!next.done) {
    const step = next.value;
    if (step.kind === "read") { next = steps.next(bytes[step.position]); continue; }
    if (!metadataOnly) {
      if (step.kind === "header") {
        data = new Uint8Array(step.metadata.width * step.metadata.height * 4);
        if (step.metadata.depth === "ushort") data16 = new Uint16Array(data.length);
      } else {
        for (const value of step.values) data[offset++] = Math.round(value / 257);
        data16?.set(step.values, offset - 4);
      }
    }
    next = steps.next();
  }
  return { ...next.value, data, ...(data16 ? { data16 } : {}) };
}

export async function readXpmFromSource(source: ImageByteSource, storage: ImageByteStorage | undefined, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  const reader = new SourceBytes(source, signal, "XPM"), steps = xpmSteps(source.size, options);
  let next = steps.next(), position = 0, offset = 0, used = 0;
  const pixels = new Uint8Array(2048);
  let samples16: Uint16Array | undefined, storedData16: StoredRgbaImage["storedData16"];
  async function flush() {
    if (!storage || !used) return;
    await storage.write(position + offset, pixels.subarray(0, used), { signal });
    if (storedData16 && samples16) await storage.write(storedData16.position + offset * 2, new Uint8Array(samples16.buffer, 0, used * 2), { signal });
    offset += used; used = 0;
  }
  while (!next.done) {
    const step = next.value;
    if (step.kind === "read") { next = steps.next(await reader.at(step.position)); continue; }
    if (storage) {
      if (step.kind === "header") {
        const length = step.metadata.width * step.metadata.height * 4;
        position = storage.allocate(length);
        if (step.metadata.depth === "ushort") {
          storedData16 = { position: storage.allocate(length * 2), length };
          samples16 = new Uint16Array(pixels.length);
        }
      } else {
        for (const value of step.values) pixels[used++] = Math.round(value / 257);
        samples16?.set(step.values, used - 4);
        if (used === pixels.length) await flush();
      }
    }
    next = steps.next();
  }
  await flush();
  return { ...next.value, position, ...(storedData16 ? { storedData16 } : {}) };
}

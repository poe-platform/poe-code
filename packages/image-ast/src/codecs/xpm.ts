import { parseColor, type ImageMetadata, type RgbaImage, type SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { XPM_COLORS } from "./xpm-colors.js";

export function isXpmBytes(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 9)) === "/* XPM */";
}

type XpmMetadata = ImageMetadata & Pick<RgbaImage, "indexedColors">;
type Step = { kind: "read"; position: number } | { kind: "header"; metadata: XpmMetadata } | { kind: "pixel"; values: number[]; index: number };
function* xpmSteps(size: number, options?: SharpInputOptions): Generator<Step, XpmMetadata, number | undefined> {
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
  const palette = new Map<string, { values: number[]; index: number }>();
  let hasAlpha = false, highDepth = false;
  for (let i = 0; i < colors; i++) {
    const line = yield* string(4096), symbol = line.slice(0, cpp), fields = words(line.slice(cpp));
    const keys = ["c", "g", "g4", "m", "s"];
    const values = new Map<string, string>();
    for (let j = 0; j < fields.length;) {
      const key = fields[j++]!, start = j;
      while (j < fields.length && !keys.includes(fields[j]!)) j++;
      if (!values.has(key)) values.set(key, fields.slice(start, j).join(" "));
    }
    const color = values.get("c") ?? values.get("g") ?? values.get("g4") ?? values.get("m") ?? values.get("s") ?? "gray";
    if (!color || symbol.length !== cpp || palette.has(symbol)) throw new Error("Invalid XPM palette");
    let rgba: number[];
    if (color.toLowerCase() === "none") { rgba = [0, 0, 0, 0]; hasAlpha = true; }
    else if (color.startsWith("#")) {
      // XPM accepts a trailing alpha component but only None enables transparency.
      const hex = color.slice(1).toLowerCase(), digits = hex.length / (hex.length % 3 === 0 ? 3 : 4);
      if (![1, 2, 3, 4].includes(digits) || [...hex].some(char => !"0123456789abcdef".includes(char))) throw new Error("Invalid XPM color");
      rgba = [0, 1, 2].map(channel => Math.round(parseInt(hex.slice(channel * digits, (channel + 1) * digits), 16) * 65535 / (16 ** digits - 1)));
      rgba.push(65535);
      highDepth ||= digits > 2;
    } else if (color.includes("(")) {
      const open = color.indexOf("("), name = color.slice(0, open).trim().toLowerCase();
      if (["rgb", "srgb", "gray", "rgba", "srgba", "graya", "hsv", "cmyk"].includes(name)) {
        const components = words(color.slice(open + 1, -1).replaceAll(",", " "));
        const channels = name.startsWith("gray") ? 1 : name === "cmyk" ? 4 : 3;
        if (!color.endsWith(")") || components.length !== channels + (name.endsWith("a") ? 1 : 0)) throw new Error("Invalid XPM color");
        const samples = components.map((component, index) => {
          const percent = component.endsWith("%"), value = percent ? component.slice(0, -1) : component;
          if (!value || [...value].some(char => !"0123456789.eE+-".includes(char)) || !Number.isFinite(Number(value))) throw new Error("Invalid XPM color");
          const sample = Number(value) / (percent ? 100 : index === channels ? 1 : 255);
          return name === "hsv" && index === 0 ? sample : Math.max(0, Math.min(1, sample));
        });
        // Only None enables transparency, but retain functional alpha for that case.
        const alpha = samples[channels] ?? 1;
        if (name === "hsv") {
          const hue = ((samples[0]! * 255 / 60) % 6 + 6) % 6;
          const value = samples[2]!, chroma = value * samples[1]!;
          const x = chroma * (1 - Math.abs(hue % 2 - 1));
          const rgb = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x]
            : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
          rgba = [...rgb.map(channel => channel + value - chroma), alpha];
        } else {
          // Native XPM copies CMY into the RGB palette slots and discards black.
          rgba = channels === 1 ? [samples[0]!, samples[0]!, samples[0]!, alpha] : [...samples.slice(0, 3), alpha];
        }
        rgba = rgba.map(value => Math.round(value * 65535));
        highDepth ||= rgba.some(value => value % 257 !== 0);
      } else if (name === "hsl" || name === "hsla") {
        const components = words(color.slice(open + 1, -1).replaceAll(",", " "));
        if (!color.endsWith(")") || components.length < 3 || components.length > 4) throw new Error("Invalid XPM color");
        const { r, g, b } = parseColor(`hsl(${components.slice(0, 3).join(",")})`);
        // Native HSL ignores alpha; HSLA scales percentages by 255/100 before clamping.
        const alpha = name === "hsla" ? components[3] ?? "1" : "1", percent = alpha.endsWith("%");
        const value = Number(percent ? alpha.slice(0, -1) : alpha);
        if (!Number.isFinite(value)) throw new Error("Invalid XPM color");
        rgba = [r * 257, g * 257, b * 257, Math.round(Math.max(0, Math.min(1, value * (percent ? 255 / 100 : 1))) * 65535)];
        highDepth ||= rgba[3]! % 257 !== 0;
      } else {
        const { r, g, b, a } = parseColor(color); rgba = [r, g, b, a].map(value => value * 257);
      }
    } else {
      // Native XPM replaces lowercase "grey" before its case-insensitive lookup.
      const name = color.replaceAll("grey", "gray").toLowerCase().split(" ").join("");
      if (!Object.hasOwn(XPM_COLORS, name)) throw new Error("Invalid XPM color");
      const rgb = XPM_COLORS[name]!;
      rgba = [rgb >>> 16, (rgb >>> 8) & 255, rgb & 255, 255].map(value => value * 257);
    }
    palette.set(symbol, { values: rgba, index: i });
  }
  const metadata: XpmMetadata = { format: "xpm", width, height, channels: hasAlpha ? 4 : 3, hasAlpha, space: "srgb", depth: highDepth ? "ushort" : "uchar", density: 72, size, ...(!hasAlpha ? { isPalette: true, indexedColors: Array.from(palette.values(), ({ values: [r, g, b, a] }) => Math.round(a! / 257) * 16777216 + Math.round(r! / 257) * 65536 + Math.round(g! / 257) * 256 + Math.round(b! / 257)) } : {}) };
  yield { kind: "header", metadata };
  for (let y = 0; y < height; y++) {
    const row = yield* string(width * cpp);
    if (row.length !== width * cpp) throw new Error("Invalid XPM row length");
    for (let x = 0; x < width; x++) {
      const entry = palette.get(row.slice(x * cpp, (x + 1) * cpp));
      if (!entry) throw new Error("Unknown XPM pixel symbol");
      yield { kind: "pixel", ...entry };
    }
  }
  return metadata;
}

export function readXpmImage(bytes: Uint8Array, options?: SharpInputOptions, metadataOnly = false): RgbaImage {
  const steps = xpmSteps(bytes.length, options);
  let next = steps.next(), data = new Uint8Array(), offset = 0;
  let data16: Uint16Array | undefined, pngIndices: Uint8Array | undefined;
  while (!next.done) {
    const step = next.value;
    if (step.kind === "read") { next = steps.next(bytes[step.position]); continue; }
    if (!metadataOnly) {
      if (step.kind === "header") {
        data = new Uint8Array(step.metadata.width * step.metadata.height * 4);
        if (step.metadata.indexedColors && step.metadata.indexedColors.length <= 256) pngIndices = new Uint8Array(data.length / 4);
        if (step.metadata.depth === "ushort") data16 = new Uint16Array(data.length);
      } else {
        if (pngIndices) pngIndices[offset / 4] = step.index;
        for (const value of step.values) data[offset++] = Math.round(value / 257);
        data16?.set(step.values, offset - 4);
      }
    }
    next = steps.next();
  }
  return { ...next.value, data, ...(pngIndices ? { pngIndices } : {}), ...(data16 ? { data16 } : {}) };
}

export async function readXpmFromSource(source: ImageByteSource, storage: ImageByteStorage | undefined, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  const reader = new SourceBytes(source, signal, "XPM"), steps = xpmSteps(source.size, options);
  let next = steps.next(), position = 0, offset = 0, used = 0;
  const pixels = new Uint8Array(2048), indices = new Uint8Array(512);
  let storedPngIndices: StoredRgbaImage["storedPngIndices"];
  let samples16: Uint16Array | undefined, storedData16: StoredRgbaImage["storedData16"];
  async function flush() {
    if (!storage || !used) return;
    await storage.write(position + offset, pixels.subarray(0, used), { signal });
    if (storedData16 && samples16) await storage.write(storedData16.position + offset * 2, new Uint8Array(samples16.buffer, 0, used * 2), { signal });
    if (storedPngIndices) await storage.write(storedPngIndices.position + offset / 4, indices.subarray(0, used / 4), { signal });
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
        if (step.metadata.indexedColors && step.metadata.indexedColors.length <= 256) storedPngIndices = { position: storage.allocate(length / 4), width: step.metadata.width, height: step.metadata.height };
      } else {
        indices[used / 4] = step.index;
        for (const value of step.values) pixels[used++] = Math.round(value / 257);
        samples16?.set(step.values, used - 4);
        if (used === pixels.length) await flush();
      }
    }
    next = steps.next();
  }
  await flush();
  return { ...next.value, position, ...(storedPngIndices ? { storedPngIndices } : {}), ...(storedData16 ? { storedData16 } : {}) };
}

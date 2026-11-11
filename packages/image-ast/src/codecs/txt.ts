import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";

const signature = "# ImageMagick pixel enumeration: ";
export function isTxtBytes(bytes: Uint8Array): boolean {
  return bytes.length >= signature.length && [...signature].every((char, index) => bytes[index] === char.charCodeAt(0));
}

type Step = { kind: "read"; position: number } | { kind: "header"; metadata: ImageMetadata } | { kind: "pixel"; offset: number; values: number[]; hueSamples?: number[] };
function* txtSteps(size: number, page: number, options?: SharpInputOptions): Generator<Step, ImageMetadata, number | undefined> {
  let position = 0, index = -1, metadata: ImageMetadata | undefined, selected: ImageMetadata | undefined, maximum = 0, pixels = 0;
  while (position < size) {
    let line = "";
    while (position < size) {
      const byte = yield { kind: "read", position: position++ };
      if (byte === undefined) throw new Error("Truncated TXT input");
      if (byte === 10) break;
      if (line.length >= 4096) throw new Error("TXT line exceeds limit");
      line += String.fromCharCode(byte);
    }
    line = line.trim();
    if (!line) continue;
    if (line.startsWith(signature)) {
      if (metadata && pixels !== metadata.width * metadata.height) throw new Error("Truncated TXT pixels");
      const fields = line.slice(signature.length).split(",");
      if (fields.length !== 4 && fields.length !== 5) throw new Error("Invalid TXT header");
      const width = Number(fields[0]), height = Number(fields[1]);
      maximum = Number(fields[fields.length - 2]);
      const space = fields[fields.length - 1]!.trim().toLowerCase();
      if (!["srgb", "srgba", "rgb", "rgba", "gray", "graya", "lineargray", "lineargraya", "cmyk", "cmyka"].includes(space)) throw new Error(`Unsupported TXT colorspace: ${space}`);
      if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 || !Number.isSafeInteger(width * height * 8) || !Number.isInteger(maximum) || maximum < 1 || maximum > 65535) throw new Error("Invalid TXT dimensions or maximum");
      checkLimitInputPixels(width, height, options);
      const linearGray = space.startsWith("lineargray");
      const cmyk = space.startsWith("cmyk"), hasAlpha = space.endsWith("a"), channels = cmyk ? (hasAlpha ? 5 : 4) : space.startsWith("gray") || linearGray ? (hasAlpha ? 2 : 1) : (hasAlpha ? 4 : 3);
      metadata = { format: "txt", width, height, channels, hasAlpha, space: cmyk ? "cmyk" : channels < 3 ? "b-w" : "srgb", ...(cmyk ? { magickColorspace: "CMYK" } : {}), depth: maximum > 255 ? "ushort" : "uchar", density: 72, size, ...(space === "rgb" || space === "rgba" ? { magickColorspace: "RGB", gamma: 1 } : {}), ...(linearGray ? { gamma: 1 } : {}) };
      pixels = 0;
      if (++index === page) { selected = metadata; yield { kind: "header", metadata }; }
      continue;
    }
    if (!metadata) throw new Error("Invalid TXT signature");
    const colon = line.indexOf(":"), open = line.indexOf("(", colon), close = line.indexOf(")", open);
    const coordinates = line.slice(0, colon).split(",").map(Number);
    const values = line.slice(open + 1, close).split(",").map(value => value.trim() === "" ? NaN : Number(value));
    if (colon < 0 || open < colon || close < open || coordinates.length !== 2 || coordinates[0] !== pixels % metadata.width || coordinates[1] !== Math.floor(pixels / metadata.width) || pixels >= metadata.width * metadata.height || values.length !== metadata.channels || values.some(value => !Number.isFinite(value) || value < 0 || value > maximum)) throw new Error("Invalid TXT pixel");
    if (index === page) {
      const r = values[0]!, g = metadata.channels < 3 ? r : values[1]!, b = metadata.channels < 3 ? r : values[2]!, a = metadata.hasAlpha ? values[values.length - 1]! : maximum;
      const hueSamples = metadata.space === "cmyk" ? values.slice(0, 4).map(value => value / maximum) : undefined;
      const rgb = hueSamples ? hueSamples.slice(0, 3).map(value => (1 - value) * (1 - hueSamples[3]!) * maximum) : [r, g, b];
      yield { kind: "pixel", offset: pixels * 4, values: [...rgb, a].map(value => Math.round(value * 65535 / maximum)), ...(hueSamples ? { hueSamples } : {}) };
    }
    pixels++;
  }
  if (!metadata || pixels !== metadata.width * metadata.height) throw new Error("Truncated TXT pixels");
  if (!selected) throw new Error("TXT page is out of range");
  return { ...selected, ...(index > 0 ? { pages: index + 1 } : {}) };
}

export function readTxtImage(bytes: Uint8Array, options?: SharpInputOptions, metadataOnly = false): RgbaImage {
  const steps = txtSteps(bytes.length, options?.page ?? 0, options);
  let next = steps.next(), data = new Uint8Array(), data16: Uint16Array | undefined, hueSamples: Float64Array | undefined;
  while (!next.done) {
    const step = next.value;
    if (step.kind === "read") { next = steps.next(bytes[step.position]); continue; }
    if (!metadataOnly) {
      if (step.kind === "header") {
        data = new Uint8Array(step.metadata.width * step.metadata.height * 4);
        if (step.metadata.depth === "ushort" || step.metadata.space === "cmyk") data16 = new Uint16Array(data.length);
        if (step.metadata.space === "cmyk") hueSamples = new Float64Array(data.length);
      } else {
        data.set(step.values.map(value => Math.round(value / 257)), step.offset);
        data16?.set(step.values, step.offset);
        if (step.hueSamples) hueSamples?.set(step.hueSamples, step.offset);
      }
    }
    next = steps.next();
  }
  return { ...next.value, data, ...(data16 ? { data16 } : {}), ...(hueSamples ? { hueSamples } : {}) };
}

export async function readTxtFromSource(source: ImageByteSource, storage: ImageByteStorage | undefined, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  const reader = new SourceBytes(source, signal, "TXT"), steps = txtSteps(source.size, options?.page ?? 0, options);
  let next = steps.next(), position = 0, storedData16: StoredRgbaImage["storedData16"], storedHueSamples: StoredRgbaImage["storedHueSamples"];
  const pixels = new Uint8Array(4096), samples = new Uint16Array(4096), hues = new Float64Array(4096);
  let used = 0, offset = 0;
  async function flush(): Promise<void> {
    if (!storage || !used) return;
    await storage.write(position + offset, pixels.subarray(0, used), { signal });
    if (storedData16) await storage.write(storedData16.position + offset * 2, new Uint8Array(samples.buffer, 0, used * 2), { signal });
    if (storedHueSamples !== undefined) await storage.write(storedHueSamples + offset * 8, new Uint8Array(hues.buffer, 0, used * 8), { signal });
    offset += used; used = 0;
  }
  while (!next.done) {
    const step = next.value;
    if (step.kind === "read") { next = steps.next(await reader.at(step.position)); continue; }
    if (storage) {
      if (step.kind === "header") {
        const length = step.metadata.width * step.metadata.height * 4;
        position = storage.allocate(length);
        if (step.metadata.depth === "ushort" || step.metadata.space === "cmyk") storedData16 = { position: storage.allocate(length * 2), length };
        if (step.metadata.space === "cmyk") storedHueSamples = storage.allocate(length * 8);
      } else {
        if (step.hueSamples) hues.set(step.hueSamples, used);
        for (const value of step.values) { pixels[used] = Math.round(value / 257); samples[used++] = value; }
        if (used === pixels.length) await flush();
      }
    }
    next = steps.next();
  }
  await flush();
  return { ...next.value, position, ...(storedData16 ? { storedData16 } : {}), ...(storedHueSamples !== undefined ? { storedHueSamples } : {}) };
}

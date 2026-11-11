import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";

const signature = "# ImageMagick pixel enumeration: ";
export function isTxtBytes(bytes: Uint8Array): boolean {
  return bytes.length >= signature.length && [...signature].every((char, index) => bytes[index] === char.charCodeAt(0));
}

function txtValues(tokens: string[], maximum: number): number[] {
  return tokens.map(value => {
    const token = value.trim(), percent = token.endsWith("%");
    const number = (percent ? token.slice(0, -1) : token).trim();
    if (number === "") return NaN;
    const component = Number(number);
    if (!percent) return component;
    if (component < 0 || component > 100) return NaN;
    return Math.trunc(component * (0.01 * maximum));
  });
}

type Step = { kind: "read"; position: number } | { kind: "header"; metadata: ImageMetadata; extraChannels: number } | { kind: "pixel"; offset: number; values: number[]; metaSamples: number[]; hueSamples?: number[] };
function* txtSteps(size: number, page: number, options?: SharpInputOptions): Generator<Step, ImageMetadata, number | undefined> {
  let position = 0, index = -1, metadata: ImageMetadata | undefined, selected: ImageMetadata | undefined, maximum = 0, range = 0, pixels = 0, extraChannels = 0;
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
      extraChannels = fields.length === 5 ? Number(fields[2]) : 0;
      if (!Number.isSafeInteger(extraChannels) || extraChannels < 0 || extraChannels > 54) throw new Error("Invalid TXT extra channels");
      maximum = Number(fields[fields.length - 2]);
      const space = fields[fields.length - 1]!.trim().toLowerCase();
      const magickColorspace = ["RGB", "XYZ", "HSL", "CIELab", "CMYK", "HSV", "HSB", "HWB", "YCbCr", "DisplayP3", "CMY", "Luv"].find(name => space === name.toLowerCase() || space === name.toLowerCase() + "a");
      if (!magickColorspace && !["srgb", "srgba", "gray", "graya", "lineargray", "lineargraya"].includes(space)) throw new Error(`Unsupported TXT colorspace: ${space}`);
      if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 || !Number.isSafeInteger(width * height * (44 + extraChannels * 44)) || !Number.isInteger(maximum) || maximum < 1 || maximum > 4294967295) throw new Error("Invalid TXT dimensions or maximum");
      checkLimitInputPixels(width, height, options);
      // TXT derives its sample range from depth, including power-of-two maxima.
      const bitsPerSample = Math.max(1, Math.ceil(Math.log2(maximum)));
      range = 2 ** bitsPerSample - 1;
      const linearGray = space.startsWith("lineargray");
      const cmyk = space.startsWith("cmyk"), hasAlpha = space.endsWith("a"), channels = cmyk ? (hasAlpha ? 5 : 4) : space.startsWith("gray") || linearGray ? (hasAlpha ? 2 : 1) : (hasAlpha ? 4 : 3);
      metadata = { ...(magickColorspace ? { magickColorspace } : {}), format: "txt", width, height, channels, hasAlpha, space: cmyk ? "cmyk" : channels < 3 ? "b-w" : "srgb", depth: bitsPerSample > 16 ? "uint" : bitsPerSample > 8 ? "ushort" : "uchar", bitsPerSample, density: 72, size, ...(space === "rgb" || space === "rgba" ? { gamma: 1 } : {}), ...(linearGray ? { gamma: 1 } : {}) };
      pixels = 0;
      if (++index === page) { selected = metadata; yield { kind: "header", metadata, extraChannels }; }
      continue;
    }
    if (!metadata) throw new Error("Invalid TXT signature");
    const colon = line.indexOf(":"), open = line.indexOf("(", colon), close = line.indexOf(")", open);
    const coordinates = line.slice(0, colon).split(",").map(Number);
    const tokens = line.slice(open + 1, close).split(",");
    // Native TXT skips explicitly signed tuple components and zero-fills the tail.
    const values = txtValues(tokens.filter(value => {
      const first = value.trim()[0];
      return first !== "+" && first !== "-";
    }), range);
    while (values.length < tokens.length) values.push(0);
    if (colon < 0 || open < colon || close < open || coordinates.length !== 2 || coordinates.some(value => !Number.isInteger(value) || value < 0) || coordinates[0]! >= metadata.width || coordinates[1]! >= metadata.height || pixels >= metadata.width * metadata.height || values.length !== metadata.channels + extraChannels || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error("Invalid TXT pixel");
    // Native TXT only re-reads the trailing srgb(...) annotation, in header units.
    const annotation = line.lastIndexOf("srgb(");
    if (annotation > close) {
      const end = line.indexOf(")", annotation);
      const components = txtValues(line.slice(annotation + 5, end).split(","), range);
      if (end < 0 || components.length !== 3 || components.some(value => !Number.isFinite(value) || value < 0 || value > Math.max(maximum, range))) throw new Error("Invalid TXT pixel");
      for (let channel = 0; channel < Math.min(3, metadata.channels - Number(metadata.hasAlpha)); channel++) values[channel] = components[channel]!;
    }
    if (index === page) {
      for (let channel = 0; channel < values.length; channel++) values[channel] = Math.min(range, Math.trunc(values[channel]!));
      const r = values[0]!, g = metadata.channels < 3 ? r : values[1]!, b = metadata.channels < 3 ? r : values[2]!, a = metadata.hasAlpha ? values[metadata.channels - 1]! : range;
      const hueSamples = metadata.space === "cmyk" ? values.slice(0, 4).map(value => value / range) : undefined;
      const rgb = hueSamples ? hueSamples.slice(0, 3).map(value => (1 - value) * (1 - hueSamples[3]!) * range) : [r, g, b];
      yield { kind: "pixel", offset: (coordinates[1]! * metadata.width + coordinates[0]!) * 4, metaSamples: values.slice(metadata.channels).map(value => Math.fround(65535 * (value / range))), values: [...rgb, a].map(value => Math.fround(65535 * (value / range))), ...(hueSamples ? { hueSamples } : {}) };
    }
    pixels++;
  }
  if (!metadata || pixels !== metadata.width * metadata.height) throw new Error("Truncated TXT pixels");
  if (!selected) throw new Error("TXT page is out of range");
  return { ...selected, ...(index > 0 ? { pages: index + 1 } : {}) };
}

export function readTxtImage(bytes: Uint8Array, options?: SharpInputOptions, metadataOnly = false): RgbaImage {
  const steps = txtSteps(bytes.length, options?.page ?? 0, options);
  const metaChannels: RgbaImage[] = [];
  let next = steps.next(), data = new Uint8Array(), data16: Uint16Array | undefined, hueSamples: Float64Array | undefined, evaluateSamples: Float64Array | undefined;
  while (!next.done) {
    const step = next.value;
    if (step.kind === "read") { next = steps.next(bytes[step.position]); continue; }
    if (!metadataOnly) {
      if (step.kind === "header") {
        data = new Uint8Array(step.metadata.width * step.metadata.height * 4);
        if (step.metadata.depth === "ushort" || step.metadata.depth === "uint" || step.metadata.space === "cmyk") data16 = new Uint16Array(data.length);
        if (65535 % (2 ** step.metadata.bitsPerSample! - 1) !== 0) evaluateSamples = new Float64Array(data.length);
        if (step.metadata.space === "cmyk") hueSamples = new Float64Array(data.length);
        for (let channel = 0; channel < step.extraChannels; channel++) metaChannels.push({
          width: step.metadata.width, height: step.metadata.height, channels: 1, hasAlpha: false, space: "b-w", depth: step.metadata.depth, format: "txt", density: step.metadata.density,
          data: new Uint8Array(data.length),
          ...(data16 ? { data16: new Uint16Array(data.length) } : {}),
          ...(evaluateSamples ? { evaluateSamples: new Float64Array(data.length) } : {}),
        });
      } else {
        data.set(step.values.map(value => Math.round(value / 257)), step.offset);
        data16?.set(step.values.map(Math.round), step.offset);
        evaluateSamples?.set(step.values.map(value => value / 257), step.offset);
        if (step.hueSamples) hueSamples?.set(step.hueSamples, step.offset);
        for (const [channel, value] of step.metaSamples.entries()) {
          const plane = metaChannels[channel]!, values = [value, value, value, 65535];
          plane.data.set(values.map(value => Math.round(value / 257)), step.offset);
          plane.data16?.set(values.map(Math.round), step.offset);
          plane.evaluateSamples?.set(values.map(value => value / 257), step.offset);
        }
      }
    }
    next = steps.next();
  }
  return { ...next.value, data, ...(metaChannels.length ? { metaChannels } : {}), ...(data16 ? { data16 } : {}), ...(hueSamples ? { hueSamples } : {}), ...(evaluateSamples ? { evaluateSamples } : {}) };
}

export async function readTxtFromSource(source: ImageByteSource, storage: ImageByteStorage | undefined, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  const reader = new SourceBytes(source, signal, "TXT"), steps = txtSteps(source.size, options?.page ?? 0, options);
  let next = steps.next(), position = 0, storedData16: StoredRgbaImage["storedData16"], storedHueSamples: StoredRgbaImage["storedHueSamples"], storedEvaluateSamples: StoredRgbaImage["storedEvaluateSamples"];
  const pixels = new Uint8Array(4096), samples = new Uint16Array(4096), hues = new Float64Array(4096), working = new Float64Array(4096);
  const storedMetaChannels: StoredRgbaImage[] = [];
  const metaBuffers: { pixels: Uint8Array; samples: Uint16Array; working: Float64Array }[] = [];
  let used = 0, offset = 0;
  async function flush(): Promise<void> {
    if (!storage || !used) return;
    await storage.write(position + offset, pixels.subarray(0, used), { signal });
    if (storedData16) await storage.write(storedData16.position + offset * 2, new Uint8Array(samples.buffer, 0, used * 2), { signal });
    if (storedEvaluateSamples !== undefined) await storage.write(storedEvaluateSamples + offset * 8, new Uint8Array(working.buffer, 0, used * 8), { signal });
    if (storedHueSamples !== undefined) await storage.write(storedHueSamples + offset * 8, new Uint8Array(hues.buffer, 0, used * 8), { signal });
    for (const [channel, plane] of storedMetaChannels.entries()) {
      const buffer = metaBuffers[channel]!;
      await storage.write(plane.position + offset, buffer.pixels.subarray(0, used), { signal });
      if (plane.storedData16) await storage.write(plane.storedData16.position + offset * 2, new Uint8Array(buffer.samples.buffer, 0, used * 2), { signal });
      if (plane.storedEvaluateSamples !== undefined) await storage.write(plane.storedEvaluateSamples + offset * 8, new Uint8Array(buffer.working.buffer, 0, used * 8), { signal });
    }
    offset += used; used = 0;
  }
  while (!next.done) {
    const step = next.value;
    if (step.kind === "read") { next = steps.next(await reader.at(step.position)); continue; }
    if (storage) {
      if (step.kind === "header") {
        const length = step.metadata.width * step.metadata.height * 4;
        position = storage.allocate(length);
        if (step.metadata.depth === "ushort" || step.metadata.depth === "uint" || step.metadata.space === "cmyk") storedData16 = { position: storage.allocate(length * 2), length };
        if (65535 % (2 ** step.metadata.bitsPerSample! - 1) !== 0) storedEvaluateSamples = storage.allocate(length * 8);
        if (step.metadata.space === "cmyk") storedHueSamples = storage.allocate(length * 8);
        for (let channel = 0; channel < step.extraChannels; channel++) {
          storedMetaChannels.push({
            width: step.metadata.width, height: step.metadata.height, channels: 1, hasAlpha: false, space: "b-w", depth: step.metadata.depth, format: "txt", density: step.metadata.density,
            position: storage.allocate(length),
            ...(storedData16 ? { storedData16: { position: storage.allocate(length * 2), length } } : {}),
            ...(storedEvaluateSamples !== undefined ? { storedEvaluateSamples: storage.allocate(length * 8) } : {}),
          });
          metaBuffers.push({ pixels: new Uint8Array(4096), samples: new Uint16Array(4096), working: new Float64Array(4096) });
        }
      } else {
        if (step.offset !== offset + used) await flush();
        if (!used) offset = step.offset;
        if (step.hueSamples) hues.set(step.hueSamples, used);
        for (const [channel, value] of step.metaSamples.entries()) {
          const buffer = metaBuffers[channel]!, values = [value, value, value, 65535];
          buffer.pixels.set(values.map(value => Math.round(value / 257)), used);
          buffer.samples.set(values.map(Math.round), used);
          buffer.working.set(values.map(value => value / 257), used);
        }
        for (const value of step.values) { pixels[used] = Math.round(value / 257); working[used] = value / 257; samples[used++] = Math.round(value); }
        if (used === pixels.length) await flush();
      }
    }
    next = steps.next();
  }
  await flush();
  return { ...next.value, position, ...(storedMetaChannels.length ? { storedMetaChannels } : {}), ...(storedData16 ? { storedData16 } : {}), ...(storedHueSamples !== undefined ? { storedHueSamples } : {}), ...(storedEvaluateSamples !== undefined ? { storedEvaluateSamples } : {}) };
}

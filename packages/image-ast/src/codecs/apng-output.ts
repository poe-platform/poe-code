import type { OutputEncodeOptions, RgbaImage } from "../ast.js";
import { encodePngImage } from "./png.js";
import { encodePngFromStorage, type ImageByteStorage, type StoredRgbaImage } from "./png-storage.js";
import { makeChunk, PNG_SIGNATURE } from "./png-chunks.js";

function animationLayout(image: Pick<RgbaImage, "width" | "height" | "pageHeight" | "loop">, options: OutputEncodeOptions) {
  const height = options.pageHeight ?? image.pageHeight ?? image.height;
  if (!Number.isSafeInteger(height) || height <= 0 || image.height % height !== 0) throw new Error("Invalid APNG frame height");
  const frames = image.height / height;
  const control = new Uint8Array(8), view = new DataView(control.buffer);
  view.setUint32(0, frames); view.setUint32(4, options.loop ?? image.loop ?? 0);
  return { height, frames, control: makeChunk("acTL", control) };
}

function frameControl(sequence: number, width: number, height: number, delay: number): Uint8Array {
  const bytes = new Uint8Array(26), view = new DataView(bytes.buffer);
  view.setUint32(0, sequence); view.setUint32(4, width); view.setUint32(8, height);
  // Image delays use milliseconds. Reduce before fitting the APNG fraction.
  let numerator = Math.max(0, Math.round(delay)), denominator = 1000;
  let a = numerator, b = denominator;
  while (b) { const remainder = a % b; a = b; b = remainder; }
  numerator /= a; denominator /= a;
  if (numerator > 65535) { denominator = Math.max(1, Math.floor(65535 * denominator / numerator)); numerator = Math.min(65535, Math.round(delay * denominator / 1000)); }
  view.setUint16(20, numerator); view.setUint16(22, denominator);
  // Full canvas frames replace the preceding frame without disposal.
  return makeChunk("fcTL", bytes);
}

function frameData(sequence: number, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 4);
  new DataView(bytes.buffer).setUint32(0, sequence); bytes.set(data, 4);
  return makeChunk("fdAT", bytes);
}

export function encodeApngImage(image: RgbaImage, options: OutputEncodeOptions): Uint8Array {
  const { height, frames, control } = animationLayout(image, options);
  const parts: Uint8Array[] = [PNG_SIGNATURE];
  let sequence = 0;
  const size = image.width * height * 4;
  for (let frame = 0; frame < frames; frame++) {
    const png = encodePngImage({ ...image, width: image.width, height, data: image.data.subarray(frame * size, (frame + 1) * size) }, { pngCoder: "png32" });
    const delay = typeof options.delay === "number" ? options.delay : options.delay?.[frame] ?? image.delay?.[frame] ?? 0;
    for (let offset = 8; offset < png.length;) {
      const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
      const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
      if (type === "IHDR") {
        if (frame === 0) parts.push(png.slice(offset, offset + length + 12), control);
        parts.push(frameControl(sequence++, image.width, height, delay));
      } else if (type === "IDAT") parts.push(frame === 0 ? png.slice(offset, offset + length + 12) : frameData(sequence++, png.subarray(offset + 8, offset + 8 + length)));
      offset += length + 12;
    }
  }
  parts.push(makeChunk("IEND", new Uint8Array()));
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export async function* encodeApngFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, options: OutputEncodeOptions): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const { height, frames, control } = animationLayout(image, options);
  yield PNG_SIGNATURE.slice();
  let sequence = 0;
  for (let frame = 0; frame < frames; frame++) {
    const delay = typeof options.delay === "number" ? options.delay : options.delay?.[frame] ?? await image.storedDelay?.at(frame, { signal }) ?? image.delay?.[frame] ?? 0;
    const raster: StoredRgbaImage = { width: image.width, height, position: image.position + frame * image.width * height * 4, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true };
    for await (const chunk of encodePngFromStorage(raster, storage, signal, { pngCoder: "png32" })) {
      const type = String.fromCharCode(...chunk.subarray(4, 8));
      if (type === "IHDR") {
        if (frame === 0) { yield chunk; yield control; }
        yield frameControl(sequence++, image.width, height, delay);
      } else if (type === "IDAT") {
        const bytes = frame === 0 ? chunk : frameData(sequence++, chunk.subarray(8, chunk.length - 4));
        for (let offset = 0; offset < bytes.length; offset += 4096) { signal.throwIfAborted(); yield bytes.subarray(offset, offset + 4096); }
      }
    }
  }
  signal.throwIfAborted();
  yield makeChunk("IEND", new Uint8Array());
}

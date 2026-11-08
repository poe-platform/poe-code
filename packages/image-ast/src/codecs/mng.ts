import type { OutputEncodeOptions, RgbaImage } from "../ast.js";
import { encodePngImage } from "./png.js";
import { encodePngFromStorage, type ImageByteStorage, type StoredRgbaImage } from "./png-storage.js";
import { makeChunk } from "./png-chunks.js";

function layout(image: Pick<RgbaImage, "width" | "height" | "pageHeight" | "loop">, options: OutputEncodeOptions, finalDelay: number) {
  const height = options.pageHeight ?? image.pageHeight ?? image.height;
  if (!Number.isSafeInteger(height) || height <= 0 || image.height % height !== 0) throw new Error("Invalid MNG frame height");
  const frames = image.height / height;
  const header = new Uint8Array(28), view = new DataView(header.buffer);
  view.setUint32(0, image.width); view.setUint32(4, height);
  view.setUint32(8, 1000); view.setUint32(16, frames);
  // Valid simplicity profile, MNG-LC features and transparency.
  view.setUint32(24, 11);
  const term = new Uint8Array(10), termView = new DataView(term.buffer);
  termView.setUint32(2, Math.max(0, Math.round(finalDelay)));
  term[0] = 3; // Repeat, then display the final frame.
  termView.setUint32(6, (options.loop ?? image.loop ?? 0) || 0x7fffffff);
  return { height, frames, chunks: [new Uint8Array([138, 77, 78, 71, 13, 10, 26, 10]), makeChunk("MHDR", header), makeChunk("TERM", term)] };
}

function frameControl(delay: number): Uint8Array {
  const bytes = new Uint8Array(10);
  bytes.set([3, 0, 2, 0, 0, 0]); // Clear canvas; change default interframe delay.
  new DataView(bytes.buffer).setUint32(6, Math.max(0, Math.round(delay)));
  return makeChunk("FRAM", bytes);
}

export function encodeMngImage(image: RgbaImage, options: OutputEncodeOptions): Uint8Array {
  const { height, frames, chunks } = layout(image, options, typeof options.delay === "number" ? options.delay : options.delay?.at(-1) ?? image.delay?.at(-1) ?? 0);
  const size = image.width * height * 4;
  for (let frame = 0; frame < frames; frame++) {
    const delay = typeof options.delay === "number" ? options.delay : options.delay?.[frame] ?? image.delay?.[frame] ?? 0;
    chunks.push(frameControl(delay), encodePngImage({ format: "png", space: "srgb", channels: 4, depth: "uchar", density: image.density, hasAlpha: true, width: image.width, height, data: image.data.subarray(frame * size, (frame + 1) * size) }, { pngCoder: "png32" }).subarray(8));
  }
  chunks.push(makeChunk("MEND", new Uint8Array()));
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function* encodeMngFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, options: OutputEncodeOptions): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const last = image.height / (options.pageHeight ?? image.pageHeight ?? image.height) - 1;
  const finalDelay = typeof options.delay === "number" ? options.delay : options.delay?.[last] ?? await image.storedDelay?.at(last, { signal }) ?? image.delay?.[last] ?? 0;
  const { height, frames, chunks } = layout(image, options, finalDelay);
  yield* chunks;
  for (let frame = 0; frame < frames; frame++) {
    const delay = typeof options.delay === "number" ? options.delay : options.delay?.[frame] ?? await image.storedDelay?.at(frame, { signal }) ?? image.delay?.[frame] ?? 0;
    yield frameControl(delay);
    let signature = true;
    for await (const chunk of encodePngFromStorage({ format: "png", space: "srgb", channels: 4, depth: "uchar", density: image.density, hasAlpha: true, width: image.width, height, position: image.position + frame * image.width * height * 4 }, storage, signal, { pngCoder: "png32" })) {
      if (signature) { signature = false; continue; }
      yield chunk;
    }
  }
  signal.throwIfAborted();
  yield makeChunk("MEND", new Uint8Array());
}

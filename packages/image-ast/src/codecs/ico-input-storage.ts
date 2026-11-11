import type { SharpInputOptions } from "../ast.js";
import { icoEntrySteps, decodeIcoDib } from "./ico-input.js";
import { isPngBytes } from "./png.js";
import { decodePngToStorage, readPngMetadataFromSource, type ImageByteSource, type ImageByteStorage, type StoredRgbaImage } from "./png-storage.js";

export async function readIcoEntryFromSource(source: ImageByteSource, signal: AbortSignal, options?: SharpInputOptions) {
  const steps = icoEntrySteps(source.size, options);
  let next = steps.next();
  while (!next.done) {
    signal.throwIfAborted();
    const { position, length } = next.value, bytes = await source.read(position, length, { signal });
    signal.throwIfAborted();
    if (bytes.length !== length) throw new Error("Truncated ICO source");
    next = steps.next(bytes);
  }
  return next.value;
}

export async function decodeIcoToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  const { metadata, position, length } = await readIcoEntryFromSource(source, signal, options);
  const payload: ImageByteSource = { size: length, async read(offset, count) {
    signal.throwIfAborted();
    if (offset < 0 || count < 0 || offset + count > length) throw new Error("Invalid ICO payload range");
    const bytes = await source.read(position + offset, count, { signal });
    signal.throwIfAborted();
    if (bytes.length !== count) throw new Error("Truncated ICO payload");
    return bytes;
  } };
  if (isPngBytes(await payload.read(0, 8))) {
    const png = await readPngMetadataFromSource(payload, signal);
    if (png.width !== metadata.width || png.height !== metadata.height) throw new Error("ICO PNG dimensions disagree with directory");
    return { ...await decodePngToStorage(payload, storage, signal, options), ...metadata };
  }
  // Bound encoded allocation by the validated DIB dimensions:
  // 124-byte header, 256 colors, RGBA and AND mask.
  if (length > 124 + 1024 + metadata.width * metadata.height * 4 + Math.ceil(metadata.width / 32) * 4 * metadata.height) throw new Error("Oversized ICO DIB");
  const image = decodeIcoDib(await payload.read(0, length), metadata), output = storage.allocate(image.data.length);
  await storage.write(output, image.data, { signal });
  return { ...metadata, position: output };
}

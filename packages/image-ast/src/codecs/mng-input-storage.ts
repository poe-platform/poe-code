import { defaultRuntime } from "@poe-code/compression";
import type { SharpInputOptions } from "../ast.js";
import { mngLayoutSteps, mngSelection } from "./mng-input.js";
import { PNG_SIGNATURE } from "./png-chunks.js";
import { decodePngToStorage, type ImageByteSource, type ImageByteStorage, type StoredRgbaImage } from "./png-storage.js";

export async function readMngLayoutFromSource(source: ImageByteSource, signal: AbortSignal) {
  const steps = mngLayoutSteps(source.size);
  let next = steps.next(), work = 0;
  while (!next.done) {
    signal.throwIfAborted();
    if (++work % 64 === 0) await defaultRuntime.yieldTurn(signal);
    const { position, length } = next.value;
    const bytes = await source.read(position, length, { signal });
    signal.throwIfAborted();
    if (bytes.length !== length) throw new Error("Truncated MNG source");
    next = steps.next(bytes);
  }
  return next.value;
}

export async function decodeMngToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  const layout = await readMngLayoutFromSource(source, signal);
  const { start, count, metadata } = mngSelection(layout, options);
  const frameSize = metadata.width * layout.metadata.height * 4;
  const position = storage.allocate(frameSize * count);
  for (let index = 0; index < count; index++) {
    await defaultRuntime.yieldTurn(signal);
    const ranges = layout.frames[start + index]!.ranges;
    const png: ImageByteSource = {
      size: 8 + ranges.reduce((size, part) => size + part.length, 0),
      async read(offset, length) {
        signal.throwIfAborted();
        const result = new Uint8Array(length);
        let cursor = 0, written = 0;
        for (const part of [{ position: -1, length: 8 }, ...ranges]) {
          const from = Math.max(offset, cursor), end = Math.min(offset + length, cursor + part.length);
          if (end > from) {
            const bytes = part.position === -1 ? PNG_SIGNATURE.subarray(from, end) : await source.read(part.position + from - cursor, end - from, { signal });
            signal.throwIfAborted();
            if (bytes.length !== end - from) throw new Error("Truncated MNG PNG source");
            result.set(bytes, written); written += bytes.length;
          }
          cursor += part.length;
          if (written === length) return result;
        }
        throw new Error("Truncated MNG PNG source");
      }
    };
    const decoded = await decodePngToStorage(png, storage, signal, options);
    for (let offset = 0; offset < frameSize; offset += 16384) {
      await defaultRuntime.yieldTurn(signal);
      const bytes = await storage.read(decoded.position + offset, Math.min(16384, frameSize - offset), { signal });
      await storage.write(position + index * frameSize + offset, bytes, { signal });
    }
  }
  return { ...metadata, position };
}

import { defaultRuntime } from "@poe-code/compression";
import type { SharpInputOptions } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { TextPixels } from "./text-pixels.js";
export async function renderTextToStorage(
  options: SharpInputOptions & { text: NonNullable<SharpInputOptions["text"]> },
  storage: ImageByteStorage,
  signal: AbortSignal
): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const pixels = new TextPixels(options.text, options.density, signal),
    length = pixels.metadata.width * pixels.metadata.height * 4;
  if (!Number.isSafeInteger(length) || length < 0)
    throw new RangeError("Invalid text backing length");
  const position = storage.allocate(length);
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + length))
    throw new RangeError("Invalid text backing allocation");
  for (let at = 0; at < length; at += 4096) {
    signal.throwIfAborted();
    const bytes = new Uint8Array(Math.min(4096, length - at));
    pixels.fill(bytes);
    await storage.write(position + at, bytes, { signal });
    signal.throwIfAborted();
    if (at % 65536 === 0) await defaultRuntime.yieldTurn(signal);
  }
  return { ...pixels.metadata, position };
}

import { decodePngToStorage } from "@poe-code/image-ast";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { RetainedImage } from "./retained-blocks.js";

/** Image samples and encoded payloads remain in the document's caller backing. */
export async function retainPdfImage(storage: PagedStorage, image: RetainedImage, signal: AbortSignal) {
  const source = {size: image.size, read: (position: number, length: number) => storage.read(image.position + position, length)};
  const signature = await source.read(0, Math.min(8, image.size));
  if (image.size > 8 && signature[0] === 137 && signature[1] === 80 && signature[2] === 78 && signature[3] === 71) {
    let failed = false, failure: unknown;
    const guarded = async <T>(operation: () => Promise<T>): Promise<T> => { try { return await operation(); } catch (error) { failed = true; failure = error; throw error; } };
    let decoded: Awaited<ReturnType<typeof decodePngToStorage>>;
    try {
      decoded = await decodePngToStorage({size: source.size, read: (position, length) => guarded(() => source.read(position, length))}, {
        allocate: length => { try { return storage.allocate(length); } catch (error) { failed = true; failure = error; throw error; } },
        read: (position, length) => guarded(() => storage.read(position, length)),
        write: (position, bytes) => guarded(() => storage.write(position, bytes))
      }, signal, {unlimited: true});
    } catch { signal.throwIfAborted(); if (failed) throw failure; return undefined; }
    const count = decoded.width * decoded.height, rgb = storage.allocate(count * 3), alpha = storage.allocate(count);
    let transparent = false;
    for (let first = 0; first < count; first += 4096) {
      signal.throwIfAborted();
      const length = Math.min(4096, count - first), bytes = await storage.read(decoded.position + first * 4, length * 4);
      const colors = new Uint8Array(length * 3), mask = new Uint8Array(length);
      for (let pixel = 0; pixel < length; pixel++) {
        colors.set(bytes.subarray(pixel * 4, pixel * 4 + 3), pixel * 3); mask[pixel] = bytes[pixel * 4 + 3]!;
        transparent ||= mask[pixel]! < 255;
      }
      await storage.write(rgb + first * 3, colors); await storage.write(alpha + first, mask); await yieldTurn(signal);
    }
    return {width: decoded.width, height: decoded.height, components: 3, jpeg: false, position: rgb, size: count * 3, alpha: transparent ? alpha : 0};
  }
  if (image.size > 3 && signature[0] === 255 && signature[1] === 216) {
    let width = 1, height = 1, components = 3, position = 2, work = 0;
    const byte = async (offset: number) => (await source.read(offset, 1))[0]!;
    while (position + 1 < image.size) {
      signal.throwIfAborted(); if (++work % 4096 === 0) await yieldTurn(signal);
      if (await byte(position) !== 255) { position++; continue; }
      while (position < image.size && await byte(position) === 255) { position++; if (++work % 4096 === 0) await yieldTurn(signal); }
      if (position >= image.size) break;
      const marker = await byte(position++);
      if (marker === 217 || marker === 218) break;
      if (marker === 216 || marker >= 208 && marker <= 215 || marker === 1) continue;
      if (position + 1 >= image.size) break;
      const length = (await byte(position) * 256 + await byte(position + 1)) - 2; position += 2;
      if (length < 0 || position + length > image.size) break;
      if ((marker === 192 || marker === 193 || marker === 194) && length >= 6) {
        const frame = await source.read(position, 6);
        height = Math.max(1, frame[1]! * 256 + frame[2]!); width = Math.max(1, frame[3]! * 256 + frame[4]!); components = frame[5]!; break;
      }
      position += length;
    }
    return {width, height, components, jpeg: true, position: image.position, size: image.size, alpha: 0};
  }
  return undefined;
}

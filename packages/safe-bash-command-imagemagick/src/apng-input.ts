import { apngSteps, blendApngPixels, decodeImage, decodeImageToStorage, type RgbaImage, type StoredRgbaImage, type ImageByteSource, type ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";

export function* decodeApngSteps(bytes: Uint8Array): Generator<void, RgbaImage[], void> {
  const steps = apngSteps(bytes.length), frames: RgbaImage[] = [], delays: number[] = [];
  let next = steps.next(), chunks: Uint8Array[] = [], canvas: Uint8Array | undefined;
  while (!next.done) {
    yield;
    const step = next.value;
    if (step.kind === "read") { next = steps.next(bytes.subarray(step.position, step.position + step.length)); continue; }
    if (step.kind === "chunk") chunks.push(step.bytes);
    else {
      const f = step.frame, encoded = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
      let offset = 0; for (const chunk of chunks) { encoded.set(chunk, offset); offset += chunk.length; }
      chunks = [];
      const { data16: ignoredData16, ...decoded } = decodeImage(encoded);
      canvas ??= new Uint8Array(f.canvasWidth * f.canvasHeight * 4);
      const previous = canvas, output = canvas.slice();
      for (let row = 0; row < f.height; row++) {
        yield;
        const offset = ((f.y + row) * f.canvasWidth + f.x) * 4;
        blendApngPixels(output.subarray(offset, offset + f.width * 4), decoded.data.subarray(row * f.width * 4, (row + 1) * f.width * 4), f.blend);
      }
      delays.push(f.delay);
      frames.push({ ...decoded, width: f.canvasWidth, height: f.canvasHeight, data: output, hasAlpha: true, channels: 4, depth: "uchar", space: "srgb", delay: delays, loop: f.loop });
      canvas = f.dispose === 2 ? previous : output.slice();
      if (f.dispose === 1) for (let row = 0; row < f.height; row++) {
        const offset = ((f.y + row) * f.canvasWidth + f.x) * 4; canvas.fill(0, offset, offset + f.width * 4);
      }
    }
    next = steps.next(new Uint8Array());
  }
  return frames;
}

export async function readApng(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, visit: (image: StoredRgbaImage, index: number, pages: number) => Promise<void>): Promise<void> {
  const steps = apngSteps(source.size);
  let next = steps.next(), start = storage.allocate(0), size = 0, canvas: number | undefined;
  while (!next.done) {
    await yieldTurn(signal);
    const step = next.value;
    if (step.kind === "read") { next = steps.next(await source.read(step.position, step.length, { signal })); continue; }
    if (step.kind === "chunk") { await storage.write(storage.allocate(step.bytes.length), step.bytes); size += step.bytes.length; }
    else {
      const f = step.frame, base = start;
      const { storedData16: ignoredData16, ...decoded } = await decodeImageToStorage({ size, read: (position, length) => storage.read(base + position, length) }, storage, signal);
      const length = f.canvasWidth * f.canvasHeight * 4;
      if (!Number.isSafeInteger(length)) throw new Error("Invalid APNG canvas size");
      const output = storage.allocate(length);
      for (let offset = 0; offset < length; offset += 16384) {
        await yieldTurn(signal);
        const count = Math.min(16384, length - offset);
        await storage.write(output + offset, canvas === undefined ? new Uint8Array(count) : await storage.read(canvas + offset, count));
      }
      for (let row = 0; row < f.height; row++) for (let x = 0; x < f.width; x += 4096) {
        await yieldTurn(signal);
        const count = Math.min(4096, f.width - x) * 4, offset = ((f.y + row) * f.canvasWidth + f.x + x) * 4;
        const pixels = new Uint8Array(await storage.read(output + offset, count));
        blendApngPixels(pixels, await storage.read(decoded.position + (row * f.width + x) * 4, count), f.blend);
        await storage.write(output + offset, pixels);
      }
      await visit({ ...decoded, position: output, width: f.canvasWidth, height: f.canvasHeight, hasAlpha: true, channels: 4, depth: "uchar", space: "srgb", loop: f.loop, storedDelay: { length: f.pages, async at() { return f.delay; } } }, f.index, f.pages);
      if (f.dispose !== 2) {
        canvas = output;
        if (f.dispose === 1) {
          // The emitted frame must remain immutable for later sequence operations.
          canvas = storage.allocate(length);
          for (let offset = 0; offset < length; offset += 16384) {
            await yieldTurn(signal);
            await storage.write(canvas + offset, await storage.read(output + offset, Math.min(16384, length - offset)));
          }
          for (let row = 0; row < f.height; row++) for (let x = 0; x < f.width; x += 4096) {
            await yieldTurn(signal);
            await storage.write(canvas + ((f.y + row) * f.canvasWidth + f.x + x) * 4, new Uint8Array(Math.min(4096, f.width - x) * 4));
          }
        }
      }
      start = storage.allocate(0); size = 0;
    }
    next = steps.next(new Uint8Array());
  }
}

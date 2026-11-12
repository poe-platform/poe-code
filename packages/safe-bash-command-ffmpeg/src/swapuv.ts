import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { formatYuv } from "./format-yuv.js";

export async function swapUv(
  frame: MediaVideoFrame, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame> {
  let source = frame.native;
  if (source?.format === 8 && source.rgba === frame.data &&
      source.width === frame.width && source.height === frame.height) {
    // Gray negotiates full-range YUV: retain luma and add neutral chroma.
    const size = frame.width * frame.height;
    budget.allocateMemory(size * 3);
    const pixels = new Uint8Array(size * 3);
    for (let offset = 0; offset < size; offset += 65536) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
      const end = Math.min(offset + 65536, size);
      pixels.set(source.pixels.subarray(offset, end), offset);
      pixels.fill(128, size + offset, size + end);
      pixels.fill(128, size * 2 + offset, size * 2 + end);
    }
    return { ...frame, native: { ...source, pixels, format: 14, fullRange: 1 } };
  }
  if (!source || source.rgba !== frame.data || source.width !== frame.width || source.height !== frame.height ||
      ![0, 4, 5, 12, 13, 14, 33, 49, 68, 79].includes(source.format)) {
    budget.allocateMemory(frame.width * frame.height * 8);
    frame = await formatYuv(frame, "yuva444p", signal);
    source = frame.native!;
  }
  const sampleBytes = source.format === 49 || source.format === 68 ? 2 : 1;
  const lumaSize = frame.width * frame.height * sampleBytes;
  const chromaSize = Math.ceil(frame.width / ([0, 4, 12, 13, 33].includes(source.format) ? 2 : 1)) *
    Math.ceil(frame.height / ([0, 12, 33].includes(source.format) ? 2 : 1)) * sampleBytes;
  budget.allocateMemory(source.pixels.length + frame.width * frame.height * 4);
  const pixels = new Uint8Array(source.pixels.length);
  // Copy in bounded chunks, preserving the original buffer and every sample bit.
  for (let offset = 0; offset < lumaSize; offset += 65536) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    const end = Math.min(offset + 65536, lumaSize);
    pixels.set(source.pixels.subarray(offset, end), offset);
    if (source.format === 33 || source.format === 79) {
      const alphaOffset = lumaSize + chromaSize * 2;
      pixels.set(source.pixels.subarray(alphaOffset + offset, alphaOffset + end), alphaOffset + offset);
    }
  }
  for (let offset = 0; offset < chromaSize; offset += 65536) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    const end = Math.min(offset + 65536, chromaSize);
    pixels.set(source.pixels.subarray(lumaSize + chromaSize + offset, lumaSize + chromaSize + end), lumaSize + offset);
    pixels.set(source.pixels.subarray(lumaSize + offset, lumaSize + end), lumaSize + chromaSize + offset);
  }
  const native = { ...source, pixels };
  const data = scaleVideoPicture({ ...frame, native }, frame.width, frame.height)!;
  return { ...frame, data, native: { ...native, rgba: data } };
}

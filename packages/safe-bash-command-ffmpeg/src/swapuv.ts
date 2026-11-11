import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { formatYuv } from "./format-yuv.js";

export async function swapUv(
  frame: MediaVideoFrame, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame> {
  let source = frame.native;
  if (!source || source.rgba !== frame.data || source.width !== frame.width || source.height !== frame.height ||
      ![0, 4, 5, 12, 13, 14, 49, 68].includes(source.format)) {
    budget.allocateMemory(frame.width * frame.height * 7);
    frame = await formatYuv(frame, "yuv444p", signal);
    source = frame.native!;
  }
  const sampleBytes = source.format === 49 || source.format === 68 ? 2 : 1;
  const lumaSize = frame.width * frame.height * sampleBytes;
  const chromaSize = Math.ceil(frame.width / ([0, 4, 12, 13].includes(source.format) ? 2 : 1)) *
    Math.ceil(frame.height / ([0, 12].includes(source.format) ? 2 : 1)) * sampleBytes;
  budget.allocateMemory(source.pixels.length + frame.width * frame.height * 4);
  const pixels = new Uint8Array(source.pixels.length);
  // Copy in bounded chunks, preserving the original buffer and every sample bit.
  for (let offset = 0; offset < lumaSize; offset += 65536) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    pixels.set(source.pixels.subarray(offset, Math.min(offset + 65536, lumaSize)), offset);
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

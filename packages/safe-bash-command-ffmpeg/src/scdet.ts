import type { MediaVideoFrame, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { meanFrameDifference } from "./select.js";

export async function sceneChangeDifference(
  frame: MediaVideoFrame, previous: MediaVideoFrame, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<number> {
  let difference = await meanFrameDifference(frame, previous, pixelFormat, budget, signal);
  const native = frame.native, previousNative = previous.native;
  if (native && previousNative && native.rgba === frame.data && previousNative.rgba === previous.data &&
      native.width === frame.width && native.height === frame.height &&
      previousNative.width === previous.width && previousNative.height === previous.height &&
      native.format === previousNative.format && [0, 4, 5, 8, 12, 13, 14].includes(native.format) && frame.width < 32) {
    // FFmpeg 7's AVX2 SAD runs one 32-byte block even when the aligned width is
    // zero, then adds the scalar row. Raw planar frames have contiguous planes
    // followed by zero padding, so narrow rows also compare subsequent samples.
    let extra = 0;
    for (let y = 0; y < frame.height; y++) {
      if (y % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      for (let x = 0; x < 32; x++) {
        const offset = y * frame.width + x;
        extra += Math.abs((native.pixels[offset] ?? 0) - (previousNative.pixels[offset] ?? 0));
      }
    }
    difference += extra / (frame.width * frame.height);
  }
  return difference * 100 / 256;
}

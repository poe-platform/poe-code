import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { sceneChangeDifference } from "./scdet.js";

export async function minterpolate(
  frames: MediaVideoFrame[], fps: number, mode: number, sceneDetection: boolean, sceneThreshold: number,
  timescale: number, pixelFormat: string | undefined, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const output: MediaVideoFrame[] = [];
  const round = (value: number) => Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
  let tick = round((frames[0]?.ptsSeconds ?? 0) * fps);
  let previousDifference = 0;
  // Native buffers one future frame and never flushes the final interval at EOF.
  for (let i = 2; i < frames.length; i++) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    const left = frames[i - 2]!, right = frames[i - 1]!, newest = frames[i]!;
    if (newest.ptsSeconds < right.ptsSeconds) tick = round(newest.ptsSeconds * fps);
    const difference = sceneDetection ? await sceneChangeDifference(right, left, pixelFormat, budget, signal) : 0;
    const sceneChanged = sceneDetection && Math.min(difference, Math.abs(difference - previousDifference)) >= sceneThreshold;
    previousDifference = difference;
    const end = right.ptsSeconds * fps;
    const lastTick = Math.floor(end + 4 * Number.EPSILON * Math.max(1, Math.abs(end)));
    const leftPts = round(left.ptsSeconds * timescale), rightPts = round(right.ptsSeconds * timescale);
    for (; tick <= lastTick; tick++) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      budget.recordFrame(left.width, left.height);
      budget.allocateMemory(96);
      // FFmpeg rounds output time to 1/1024 input ticks, then truncates the ratio.
      const alpha = rightPts > leftPts
        ? Math.max(0, Math.min(1024, Math.trunc((round(tick * timescale * 1024 / fps) - leftPts * 1024) / (rightPts - leftPts))))
        : 0;
      let frame = alpha > 512 ? right : left;
      if (mode === 1 && !sceneChanged && alpha > 0 && alpha < 1024) {
        const native = left.native, rightNative = right.native;
        if (pixelFormat === "yuv420p") {
          if (!native || !rightNative || native.format !== 0 || rightNative.format !== 0 ||
              native.rgba !== left.data || rightNative.rgba !== right.data ||
              native.width !== left.width || native.height !== left.height ||
              rightNative.width !== left.width || rightNative.height !== left.height ||
              native.pixels.length !== rightNative.pixels.length) {
            throw new Error("minterpolate: requires retained planar YUV420 input");
          }
          budget.allocateMemory(left.data.length + native.pixels.length);
          const pixels = new Uint8Array(native.pixels.length);
          for (let p = 0; p < pixels.length; p++) {
            if (p % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            pixels[p] = (alpha * rightNative.pixels[p]! + (1024 - alpha) * native.pixels[p]! + 512) >> 10;
          }
          const blended = { ...native, pixels };
          const data = scaleVideoPicture({ ...left, native: blended }, left.width, left.height)!;
          frame = { ...newest, data, native: { ...blended, rgba: data } };
        } else {
          budget.allocateMemory(left.data.length + left.width * left.height);
          const data = new Uint8Array(left.data.length);
          const pixels = new Uint8Array(left.width * left.height);
          for (let p = 0; p < pixels.length; p++) {
            if (p % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const gray = (alpha * right.data[p * 4]! + (1024 - alpha) * left.data[p * 4]! + 512) >> 10;
            pixels[p] = gray;
            data.fill(gray, p * 4, p * 4 + 3);
            data[p * 4 + 3] = 255;
          }
          frame = { ...newest, data, native: {
            pixels, rgba: data, width: left.width, height: left.height, format: 8, fullRange: 1, colorspace: 5
          } };
        }
      }
      output.push({ ...frame, ptsSeconds: tick / fps, durationSeconds: 1 / fps });
    }
  }
  return output;
}

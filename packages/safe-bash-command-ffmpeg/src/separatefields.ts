import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function separateFields(
  frames: (MediaVideoFrame & { interlaced?: boolean; topFieldFirst?: boolean })[],
  budget: MediaBudgetTracker,
  endTimeSeconds: number | undefined,
  signal?: AbortSignal
): Promise<(MediaVideoFrame & { interlaced: boolean; topFieldFirst: boolean })[]> {
  const output: (MediaVideoFrame & { interlaced: boolean; topFieldFirst: boolean })[] = [];
  let work = 0;
  budget.checkSamples(frames.length * 2);
  for (const [index, frame] of frames.entries()) {
    if (frame.height % 2) throw new Error("separatefields: height must be even");
    const height = frame.height / 2;
    const durationSeconds = frame.durationSeconds / 2;
    for (let field = 0; field < 2; field++) {
      budget.checkCpu();
      signal?.throwIfAborted();
      budget.recordFrame(frame.width, height);
      const parity = frame.topFieldFirst ? field : 1 - field;
      const result = { ...frame, height, durationSeconds,
        ptsSeconds: frame.ptsSeconds + (field ? ((frames[index + 1]?.ptsSeconds ?? endTimeSeconds ??
          frame.ptsSeconds + frame.durationSeconds) - frame.ptsSeconds) / 2 : 0),
        interlaced: false, topFieldFirst: false };
      const native = frame.native;
      if (native && native.rgba === frame.data && native.width === frame.width && native.height === frame.height &&
          [0, 4, 5, 8, 12, 13, 14, 29, 30, 34, 49, 68, 104].includes(native.format)) {
        const hsub = [0, 4, 12, 13].includes(native.format) ? 2 : 1;
        const vsub = [0, 12].includes(native.format) ? 2 : 1;
        const planes = [8, 29, 30, 34, 104].includes(native.format) ? 1 : 3;
        const sampleBytes = native.format === 34 ? 6 : native.format === 104 ? 8
          : [29, 30, 49, 68].includes(native.format) ? 2 : 1;
        const pixelBytes = (frame.width * height + (planes - 1) * Math.ceil(frame.width / hsub) * Math.ceil(height / vsub)) * sampleBytes;
        budget.allocateMemory(pixelBytes + frame.width * height * 4 + 128);
        const pixels = new Uint8Array(pixelBytes);
        let inputOffset = 0;
        let outputOffset = 0;
        for (let plane = 0; plane < planes; plane++) {
          const stride = Math.ceil(frame.width / (plane === 0 ? 1 : hsub)) * sampleBytes;
          const inputHeight = Math.ceil(frame.height / (plane === 0 ? 1 : vsub));
          const planeHeight = Math.ceil(height / (plane === 0 ? 1 : vsub));
          for (let row = 0; row < planeHeight; row++) {
            if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const start = inputOffset + Math.min(inputHeight - 1, row * 2 + parity) * stride;
            pixels.set(native.pixels.subarray(start, start + stride), outputOffset + row * stride);
          }
          inputOffset += inputHeight * stride;
          outputOffset += planeHeight * stride;
        }
        result.native = { ...native, height, pixels };
        result.data = scaleVideoPicture(result, frame.width, height)!;
        result.native = { ...result.native, rgba: result.data };
      } else {
        budget.allocateMemory(frame.width * height * 4 + 128);
        result.data = new Uint8Array(frame.width * height * 4);
        const stride = frame.width * 4;
        for (let row = 0; row < height; row++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const start = (row * 2 + parity) * stride;
          result.data.set(frame.data.subarray(start, start + stride), row * stride);
        }
        delete result.native;
      }
      output.push(result);
    }
  }
  return output;
}

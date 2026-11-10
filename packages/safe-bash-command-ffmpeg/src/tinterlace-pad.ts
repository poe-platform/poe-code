import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function padTinterlace(
  frames: MediaVideoFrame[], budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const output: MediaVideoFrame[] = [];
  let work = 0;
  // Native tinterlace buffers the next frame and does not flush it at EOF.
  for (let index = 0; index + 1 < frames.length; index++) {
    const frame = frames[index]!;
    const height = frame.height * 2;
    budget.recordFrame(frame.width, height);
    const padded = { ...frame, height };
    const native = frame.native;
    if (native?.rgba === frame.data && native.width === frame.width && native.height === frame.height &&
        [0, 4, 5, 12, 13, 14, 49, 68].includes(native.format)) {
      const hsub = [0, 4, 12, 13].includes(native.format) ? 2 : 1;
      const vsub = [0, 12].includes(native.format) ? 2 : 1;
      const depth = native.format === 49 ? 16 : native.format === 68 ? 10 : 8;
      const sampleBytes = depth > 8 ? 2 : 1;
      const size = (frame.width * height + 2 * Math.ceil(frame.width / hsub) * Math.ceil(height / vsub)) * sampleBytes;
      budget.allocateMemory(size + frame.width * height * 4 + 128);
      const pixels = new Uint8Array(size);
      const view = new DataView(pixels.buffer);
      const fullRange = native.fullRange || [12, 13, 14].includes(native.format);
      let sourceOffset = 0;
      let targetOffset = 0;
      for (let plane = 0; plane < 3; plane++) {
        const stride = Math.ceil(frame.width / (plane === 0 ? 1 : hsub)) * sampleBytes;
        const sourceHeight = Math.ceil(frame.height / (plane === 0 ? 1 : vsub));
        const targetHeight = Math.ceil(height / (plane === 0 ? 1 : vsub));
        // FFmpeg's draw color expands 8-bit black and neutral chroma to the full sample range.
        const black = fullRange ? (plane === 0 ? 0 : 2 ** (depth - 1))
          : Math.round((plane === 0 ? 16 : 128) * (2 ** depth - 1) / 255);
        for (let row = 0; row < targetHeight; row++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const target = targetOffset + row * stride;
          if (row % 2 === index % 2) {
            const source = sourceOffset + Math.floor(row / 2) * stride;
            pixels.set(native.pixels.subarray(source, source + stride), target);
          } else if (sampleBytes === 1) pixels.fill(black, target, target + stride);
          else for (let column = 0; column < stride; column += 2) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            view.setUint16(target + column, black, true);
          }
        }
        sourceOffset += sourceHeight * stride;
        targetOffset += targetHeight * stride;
      }
      padded.native = { ...native, height, pixels };
      padded.data = scaleVideoPicture(padded, frame.width, height)!;
      padded.native = { ...padded.native, rgba: padded.data };
    } else {
      budget.allocateMemory(frame.width * height * 4 + 128);
      padded.data = new Uint8Array(frame.width * height * 4);
      const stride = frame.width * 4;
      for (let row = 0; row < height; row++) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const target = row * stride;
        if (row % 2 === index % 2) {
          const source = Math.floor(row / 2) * stride;
          padded.data.set(frame.data.subarray(source, source + stride), target);
        } else for (let column = 3; column < stride; column += 4) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          padded.data[target + column] = 255;
        }
      }
      delete padded.native;
    }
    output.push(padded);
  }
  return output;
}

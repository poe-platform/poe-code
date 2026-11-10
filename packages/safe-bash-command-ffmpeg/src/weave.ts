import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function weave(
  frames: MediaVideoFrame[], argument: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  let field = "top";
  for (const [index, option] of options.entries()) {
    const separator = option.indexOf("=");
    if (separator < 0 ? index !== 0 : option.slice(0, separator).trim() !== "first_field") {
      throw new Error("weave: unsupported option");
    }
    field = (separator < 0 ? option : option.slice(separator + 1)).trim();
  }
  if (!["top", "t", "0", "bottom", "b", "1"].includes(field)) {
    throw new Error("weave: first_field must be top or bottom");
  }
  const topFieldFirst = ["top", "t", "0"].includes(field);
  const output: MediaVideoFrame[] = [];
  let work = 0;
  for (let index = 0; index + 1 < frames.length; index += 2) {
    const first = frames[index]!;
    const second = frames[index + 1]!;
    if (first.width !== second.width || first.height !== second.height) {
      throw new Error("weave: adjacent frames must have matching dimensions");
    }
    const height = first.height * 2;
    budget.recordFrame(first.width, height);
    const top = topFieldFirst ? first : second;
    const bottom = topFieldFirst ? second : first;
    const woven = { ...first, height,
      durationSeconds: first.durationSeconds + second.durationSeconds,
      interlaced: true, topFieldFirst };
    const native = first.native;
    if (native && [0, 4, 5, 12, 13, 14, 49, 68].includes(native.format) && [first, second].every(frame =>
      frame.native?.rgba === frame.data && frame.native.width === frame.width && frame.native.height === frame.height &&
      frame.native.format === native.format && frame.native.colorspace === native.colorspace && frame.native.fullRange === native.fullRange)) {
      const hsub = [0, 4, 12, 13].includes(native.format) ? 2 : 1;
      const vsub = [0, 12].includes(native.format) ? 2 : 1;
      const sampleBytes = [49, 68].includes(native.format) ? 2 : 1;
      const size = (first.width * height + 2 * Math.ceil(first.width / hsub) * Math.ceil(height / vsub)) * sampleBytes;
      budget.allocateMemory(size + first.width * height * 4 + 128);
      const pixels = new Uint8Array(size);
      let sourceOffset = 0;
      let targetOffset = 0;
      for (let plane = 0; plane < 3; plane++) {
        const stride = Math.ceil(first.width / (plane === 0 ? 1 : hsub)) * sampleBytes;
        const sourceHeight = Math.ceil(first.height / (plane === 0 ? 1 : vsub));
        const targetHeight = Math.ceil(height / (plane === 0 ? 1 : vsub));
        for (let row = 0; row < targetHeight; row++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const source = (row % 2 === 0 ? top : bottom).native!;
          const start = sourceOffset + Math.floor(row / 2) * stride;
          pixels.set(source.pixels.subarray(start, start + stride), targetOffset + row * stride);
        }
        sourceOffset += sourceHeight * stride;
        targetOffset += targetHeight * stride;
      }
      woven.native = { ...native, height, pixels };
      woven.data = scaleVideoPicture(woven, first.width, height)!;
      woven.native = { ...woven.native, rgba: woven.data };
    } else {
      budget.allocateMemory(first.width * height * 4 + 128);
      woven.data = new Uint8Array(first.width * height * 4);
      const stride = first.width * 4;
      for (let row = 0; row < height; row++) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const source = row % 2 === 0 ? top : bottom;
        const start = Math.floor(row / 2) * stride;
        woven.data.set(source.data.subarray(start, start + stride), row * stride);
      }
      delete woven.native;
    }
    output.push(woven);
  }
  return output;
}

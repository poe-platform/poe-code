import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { validateWeaveGenericOption } from "./weave-generic-option.js";
import { parseFilterExpression } from "./filter-expression.js";

export async function doubleweave(
  frames: (MediaVideoFrame & { filterMetadata?: Record<string, string> })[], argument: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  let field = 0;
  for (const [index, option] of options.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? "" : option.slice(0, separator).trim();
    if (["threads", "thread_type", "extra_hw_frames"].includes(key)) {
      validateWeaveGenericOption(key, option.slice(separator + 1).trim(), "doubleweave");
      continue;
    }
    if (separator < 0 && index !== 0) throw new Error("doubleweave: unexpected positional argument");
    if (separator >= 0 && key !== "first_field") {
      throw new Error(`doubleweave: unsupported option ${key}`);
    }
    field = parseFilterExpression((separator < 0 ? option : option.slice(separator + 1)).trim(), "doubleweave", {
      top: 0, t: 0, bottom: 1, b: 1, default: 0, min: 0, max: 1,
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!Number.isFinite(field) || field < 0 || field > 1) {
      throw new RangeError("doubleweave: first_field must be top or bottom");
    }
  }
  // Integer AVOptions round ties to even: 0.5 selects the top field.
  const topFieldFirst = field <= 0.5;
  const output: MediaVideoFrame[] = [];
  let work = 0;
  for (let index = 0; index + 1 < frames.length; index++) {
    const first = frames[index]!;
    const second = frames[index + 1]!;
    if (first.width !== second.width || first.height !== second.height) {
      throw new Error("doubleweave: adjacent frames must have matching dimensions");
    }
    const height = first.height * 2;
    budget.recordFrame(first.width, height);
    const top = (index % 2 ? !topFieldFirst : topFieldFirst) ? first : second;
    const bottom = top === first ? second : first;
    const woven = { ...first, height,
      filterMetadata: second.filterMetadata,
      interlaced: true, topFieldFirst };
    const native = first.native;
    if (native && [0, 4, 5, 12, 13, 14, 29, 30, 34, 49, 68, 104].includes(native.format) && [first, second].every(frame =>
      frame.native?.rgba === frame.data && frame.native.width === frame.width && frame.native.height === frame.height &&
      frame.native.format === native.format && frame.native.colorspace === native.colorspace && frame.native.fullRange === native.fullRange)) {
      const hsub = [0, 4, 12, 13].includes(native.format) ? 2 : 1;
      const vsub = [0, 12].includes(native.format) ? 2 : 1;
      const planes = [29, 30, 34, 104].includes(native.format) ? 1 : 3;
      const sampleBytes = native.format === 34 ? 6 : native.format === 104 ? 8
        : [29, 30, 49, 68].includes(native.format) ? 2 : 1;
      const size = (first.width * height + (planes - 1) * Math.ceil(first.width / hsub) * Math.ceil(height / vsub)) * sampleBytes;
      budget.allocateMemory(size + first.width * height * 4 + 128);
      const pixels = new Uint8Array(size);
      let sourceOffset = 0;
      let targetOffset = 0;
      for (let plane = 0; plane < planes; plane++) {
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

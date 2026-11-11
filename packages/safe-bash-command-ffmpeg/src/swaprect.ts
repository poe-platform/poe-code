import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function swapRect(
  frame: MediaVideoFrame, expressions: readonly string[], n: number, sar: number,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame> {
  const variables = { w: frame.width, h: frame.height, a: frame.width / frame.height,
    n, t: frame.ptsSeconds, pos: frame.offset ?? NaN, sar, dar: frame.width / frame.height * sar };
  const values = expressions.map(expression => Math.trunc(parseFilterExpression(expression, "swaprect", variables)));
  if (values.some(value => !Number.isSafeInteger(value))) throw new Error("swaprect: invalid rectangle");
  const width = values[0]!;
  const height = values[1]!;
  if (width < 0 || height < 0) throw new Error("swaprect: rectangle dimensions must be nonnegative");
  const x1 = Math.max(0, Math.min(frame.width - 1, values[2]!));
  const y1 = Math.max(0, Math.min(frame.height - 1, values[3]!));
  const x2 = Math.max(0, Math.min(frame.width - 1, values[4]!));
  const y2 = Math.max(0, Math.min(frame.height - 1, values[5]!));
  const clippedWidth = Math.min(width, frame.width - x1, frame.width - x2);
  const clippedHeight = Math.min(height, frame.height - y1, frame.height - y2);
  const native = frame.native?.rgba === frame.data && frame.native.width === frame.width &&
    frame.native.height === frame.height &&
    [0, 4, 5, 8, 12, 13, 14, 29, 30, 33, 34, 35, 45, 49, 62, 68, 79, 104, 105].includes(frame.native.format)
    ? frame.native : undefined;
  const format = native?.format ?? -1;
  const hsub = [0, 4, 12, 13, 33, 45, 62].includes(format) ? 2 : 1;
  const vsub = [0, 12, 33, 45, 62].includes(format) ? 2 : 1;
  const planes = !native || [8, 29, 30, 34, 35, 104, 105].includes(format) ? 1
    : format === 33 || format === 79 ? 4 : 3;
  const sampleBytes = !native ? 4 : [34, 35].includes(format) ? 6 : [104, 105].includes(format) ? 8
    : [29, 30, 45, 49, 62, 68].includes(format) ? 2 : 1;
  const source = native?.pixels ?? frame.data;
  budget.allocateMemory(source.length + frame.width * sampleBytes + (native ? frame.data.length : 0));
  const pixels = new Uint8Array(source.length);
  const row = new Uint8Array(frame.width * sampleBytes);
  for (let offset = 0; offset < source.length; offset += 65536) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    pixels.set(source.subarray(offset, offset + 65536), offset);
  }
  let offset = 0;
  for (let plane = 0; plane < planes; plane++) {
    const horizontal = plane === 1 || plane === 2 ? hsub : 1;
    const vertical = plane === 1 || plane === 2 ? vsub : 1;
    const stride = Math.ceil(frame.width / horizontal) * sampleBytes;
    const rows = Math.ceil(clippedHeight / vertical);
    const columns = Math.ceil(clippedWidth / horizontal);
    // FFmpeg leaves a plane unchanged when clipping reduces its rectangle size.
    if (rows === Math.ceil(height / vertical) && columns === Math.ceil(width / horizontal)) {
      const bytes = columns * sampleBytes;
      let first = offset + Math.floor(y1 / vertical) * stride + Math.floor(x1 / horizontal) * sampleBytes;
      let second = offset + Math.floor(y2 / vertical) * stride + Math.floor(x2 / horizontal) * sampleBytes;
      for (let y = 0; y < rows; y++, first += stride, second += stride) {
        if (y % 32 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        row.set(pixels.subarray(first, first + bytes));
        pixels.copyWithin(first, second, second + bytes);
        pixels.set(row.subarray(0, bytes), second);
      }
    }
    offset += stride * Math.ceil(frame.height / vertical);
  }
  if (native) {
    const output = { ...native, pixels };
    const data = scaleVideoPicture({ ...frame, native: output }, frame.width, frame.height)!;
    return { ...frame, data, native: { ...output, rgba: data } };
  }
  return { ...frame, data: pixels };
}

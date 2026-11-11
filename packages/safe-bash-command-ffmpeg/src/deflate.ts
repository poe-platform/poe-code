import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function deflate(
  frames: MediaVideoFrame[], options: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const thresholds = { threshold0: 65535, threshold1: 65535, threshold2: 65535, threshold3: 65535 };
  let enable: string | undefined;
  let position = 0;
  if (options.endsWith(":")) options = options.slice(0, -1);
  for (const option of options ? options.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? Object.keys(thresholds)[position++] : option.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    const expression = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "enable") { enable = expression; continue; }
    if (key !== "threshold0" && key !== "threshold1" && key !== "threshold2" && key !== "threshold3") {
      throw new Error(`deflate: unsupported option ${key ?? option}`);
    }
    const value = parseFilterExpression(expression, "deflate", { min: 0, max: 65535, default: 65535 });
    if (!expression || !Number.isFinite(value) || value < 0 || value > 65535) {
      throw new RangeError(`deflate: ${key} must be between 0 and 65535`);
    }
    const lower = Math.floor(value);
    thresholds[key] = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  }

  const output: MediaVideoFrame[] = [];
  const registers = new Float64Array(10);
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    const retained = frame.native;
    const native = retained?.rgba === frame.data && retained.width === frame.width && retained.height === frame.height
      ? retained : undefined;
    const gray = native ? native.format === 8 : pixelFormat === "gray" || pixelFormat === "gray8";
    if (native ? ![0, 4, 5, 8, 12, 13, 14].includes(native.format) : !gray) {
      throw new Error("deflate: only 8-bit grayscale or planar YUV input is supported");
    }
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN };
      parseFilterExpression(enable, "deflate enable", variables, undefined, registers);
      if (!(Math.abs(parseFilterExpression(enable, "deflate enable", variables, undefined, registers)) >= 0.5)) {
        output.push(frame);
        continue;
      }
    }
    const source = native?.pixels;
    const length = source?.length ?? frame.width * frame.height;
    budget.allocateMemory(length + frame.width * frame.height * 4);
    const pixels = new Uint8Array(length);
    const read = (index: number) => source ? source[index]! : frame.data[index * 4]!;
    const hsub = native && [0, 4, 12, 13].includes(native.format) ? 2 : 1;
    const vsub = native && [0, 12].includes(native.format) ? 2 : 1;
    let offset = 0;
    for (const [plane, threshold] of Object.values(thresholds).entries()) {
      if (plane >= (gray ? 1 : 3)) break;
      const width = Math.ceil(frame.width / (plane ? hsub : 1));
      const height = Math.ceil(frame.height / (plane ? vsub : 1));
      for (let y = 0; y < height; y++) {
        const above = Math.max(0, y - 1) * width + offset;
        const row = y * width + offset;
        const below = Math.min(height - 1, y + 1) * width + offset;
        for (let x = 0; x < width; x++) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const left = x === 0 ? Math.min(1, width - 1) : x - 1;
          const right = x === width - 1 ? Math.max(0, x - 1) : x + 1;
          const center = read(row + x);
          // Exclude the center, reflect columns, repeat edge rows, and truncate the mean.
          const average = Math.floor((read(above + left) + read(above + x) + read(above + right) +
            read(row + left) + read(row + right) + read(below + left) + read(below + x) + read(below + right)) / 8);
          pixels[row + x] = Math.min(center, Math.max(center - threshold, average));
        }
      }
      offset += width * height;
    }
    const filtered = native ? { ...native, pixels } : {
      pixels, rgba: frame.data, width: frame.width, height: frame.height, format: 8, colorspace: 5, fullRange: 1
    };
    const data = scaleVideoPicture({ ...frame, native: filtered }, frame.width, frame.height)!;
    output.push({ ...frame, data, native: { ...filtered, rgba: data } });
  }
  return output;
}

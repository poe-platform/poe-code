import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { meanFrameDifference } from "./select.js";
import { sceneChangeDifference } from "./scdet.js";

export async function interpolateFrameRate(
  frames: MediaVideoFrame[], argument: string, inputTimescale: number,
  pixelFormat: string | undefined, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ frames: MediaVideoFrame[]; timescale: number; frameRate: number }> {
  const options: Record<string, string> = {};
  const keys = ["fps", "interp_start", "interp_end", "scene", "flags"];
  let position = 0;
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const part of argument ? argument.split(":") : []) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? keys[position++] : part.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    if (key === "enable") throw new Error("framerate: timeline is unsupported");
    if (!key || !keys.includes(key)) throw new Error(`framerate: unsupported option ${key ?? part}`);
    options[key] = (separator < 0 ? part : part.slice(separator + 1)).trim();
  }
  const frameRate = parseFilterExpression(options.fps ?? "50", "framerate", {
    ntsc: 30000 / 1001, pal: 25, film: 24, "ntsc-film": 24000 / 1001,
    qntsc: 30000 / 1001, qpal: 25, sntsc: 30000 / 1001, spal: 25
  });
  if (frameRate <= 0 || frameRate > 2147483647) throw new Error("framerate: invalid frame rate");
  const values = ["interp_start", "interp_end", "scene", "flags"].map((key, index) => {
    const defaults = [15, 240, 8.2, 1];
    const max = [255, 255, 100, 2147483647][index]!;
    const value = parseFilterExpression(options[key] ?? String(defaults[index]), "framerate", {
      default: defaults[index]!, min: 0, max, scd: 1, scene_change_detect: 1
    });
    if (value < 0 || value > max) throw new RangeError(`framerate: ${key} out of range`);
    if (key === "scene") return value;
    const lower = Math.floor(value);
    return value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  });
  const [interpStart, interpEnd, scene, flags] = values as [number, number, number, number];

  // Use the common tick of the input clock and requested output period.
  const ratios = [1 / inputTimescale, 1 / frameRate].map(ratio => {
    let value = ratio, numerator = 1, denominator = 0, previousNumerator = 0, previousDenominator = 1;
    while (Number.isFinite(value)) {
      const whole = Math.floor(value);
      const nextNumerator = whole * numerator + previousNumerator;
      const nextDenominator = whole * denominator + previousDenominator;
      if (nextNumerator > 2147483647 || nextDenominator > 2147483647) break;
      [previousNumerator, numerator] = [numerator, nextNumerator];
      [previousDenominator, denominator] = [denominator, nextDenominator];
      if (Math.abs(numerator / denominator - ratio) <= ratio * 1e-12) break;
      value = 1 / (value - whole);
    }
    return [numerator, denominator] as const;
  });
  const [input, output] = ratios as [readonly [number, number], readonly [number, number]];
  let divisor = input[0] * output[1], remainder = input[1] * output[0];
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const timescale = input[1] * output[1] / divisor;
  const gray = pixelFormat === "gray" || pixelFormat === "gray8";
  const result: MediaVideoFrame[] = [];
  let previous: MediaVideoFrame | undefined, next: MediaVideoFrame | undefined;
  let start = 0, count = 0, previousDifference = 0;
  let work = 0;
  const emit = async (flush: boolean) => {
    if (!next || !previous && !flush) return;
    const delta = previous ? next.ptsSeconds - previous.ptsSeconds : 0;
    let score: number | undefined;
    while (next) {
      const pts = start + Math.round(count * timescale / frameRate) / timescale;
      const end = next.ptsSeconds + (flush ? delta : 0);
      if (previous && pts >= end - 1e-12 / timescale) break;
      if (++work % 256 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
      budget.checkCpu();
      budget.checkSamples(result.length + 1);
      budget.recordFrame(next.width, next.height);
      budget.checkDuration((result.length + 1) / frameRate);
      budget.allocateMemory(128);
      let frame = next;
      if (previous) {
        // Native blends 8-bit samples with seven-bit weights, while
        // interpolation thresholds use a separate eight-bit position.
        const factor = Math.round((pts - previous.ptsSeconds) * 128 / delta);
        const position = Math.round((pts - previous.ptsSeconds) * 256 / delta);
        if (factor >= 128 || position > interpEnd) frame = next;
        else if (factor <= 0 || position < interpStart) frame = previous;
        else {
          if (score === undefined && (flags & 1)) {
            // Gray is negotiated to padded full-range YUV444 planes. Native
            // FFmpeg 7's narrow-row SAD compares the luma row twice below 32px.
            const difference = gray
              ? await meanFrameDifference(next, previous, pixelFormat, budget, signal) * 100 / 256 * (next.width < 32 ? 2 : 1)
              : await sceneChangeDifference(next, previous, pixelFormat, budget, signal);
            score = Math.fround(Math.min(difference, Math.abs(difference - previousDifference), 100));
            previousDifference = difference;
          }
          frame = factor > 64 ? next : previous;
          if ((score ?? 0) < scene) {
            const source = previous.native!, target = next.native!;
            budget.allocateMemory(source.pixels.length + previous.data.length);
            const pixels = new Uint8Array(source.pixels.length);
            for (let i = 0; i < pixels.length; i++) {
              if (i % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
              pixels[i] = (source.pixels[i]! * (128 - factor) + target.pixels[i]! * factor + 64) >> 7;
            }
            const native = { ...source, pixels };
            const data = scaleVideoPicture({ ...previous, native }, previous.width, previous.height)!;
            frame = { ...previous, data, native: { ...native, rgba: data } };
          }
        }
      }
      result.push({ ...frame, ptsSeconds: pts,
        // FFmpeg copies duration ticks without rescaling them to the new clock.
        durationSeconds: frame.durationSeconds * inputTimescale / timescale });
      count++;
      if (!previous) break;
    }
  };
  for (let frame of frames) {
    signal?.throwIfAborted();
    budget.checkCpu();
    if (!Number.isFinite(frame.ptsSeconds) || frame.ptsSeconds === next?.ptsSeconds) continue;
    if (next && (frame.width !== next.width || frame.height !== next.height)) {
      throw new Error("framerate: frames must have matching dimensions");
    }
    if (gray) {
      const size = frame.width * frame.height;
      budget.allocateMemory(size * 3);
      const pixels = new Uint8Array(size * 3).fill(128);
      for (let i = 0; i < size; i++) {
        if (i % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        pixels[i] = frame.data[i * 4]!;
      }
      frame = { ...frame, native: { pixels, width: frame.width, height: frame.height,
        format: 14, fullRange: 1, colorspace: 5, rgba: frame.data } };
    }
    if (!frame.native || frame.native.rgba !== frame.data || ![0, 4, 5, 12, 13, 14].includes(frame.native.format)) {
      throw new Error("framerate: supported input is 8-bit grayscale or planar YUV");
    }
    previous = next;
    next = frame;
    if (!previous || next.ptsSeconds < previous.ptsSeconds) {
      previous = undefined;
      start = next.ptsSeconds;
      count = 0;
    }
    await emit(false);
  }
  await emit(true);
  return { frames: result, timescale, frameRate };
}

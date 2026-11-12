import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";
import { parseFilterExpression } from "./filter-expression.js";
import { parseFilterBoolean } from "./filter-boolean.js";
import { parseColorRgba } from "./ffmpeg-colors.js";
import { formatYuv } from "./format-yuv.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function fadeVideo(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined, timescale: number,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  let type = 0, startFrame = 0, count = 25, startTime = 0, duration = 0;
  let alpha = false, timed = false;
  let color: readonly number[] = [0, 0, 0, 255];
  let enable: string | undefined;
  let position = 0;
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  for (const option of options) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["type", "start_frame", "nb_frames", "alpha", "start_time", "duration", "color"][position++] : option.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "alpha") { alpha = parseFilterBoolean(value, "fade: invalid alpha"); continue; }
    if (key === "color" || key === "c") {
      try { color = parseColorRgba(value); }
      catch { throw new Error(`fade: invalid color ${value}`); }
      continue;
    }
    if (key === "enable") { enable = value; continue; }
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, value, "fade");
      continue;
    }
    if (key === "start_time" || key === "st" || key === "duration" || key === "d") {
      const time = parseHlsDuration(value);
      if (!value || !Number.isFinite(time)) throw new Error(`fade: invalid ${key}`);
      if (time < 0 || time > 9223372036854.775) throw new RangeError(`fade: invalid ${key}`);
      // AV_OPT_TYPE_DURATION truncates to microseconds before time-base rescaling.
      const ticks = Math.round(time * timescale);
      if (key === "start_time" || key === "st") startTime = ticks;
      else { duration = ticks; timed = time !== 0; }
      continue;
    }
    const isType = key === "type" || key === "t";
    const isCount = key === "nb_frames" || key === "n";
    if (!isType && !isCount && key !== "start_frame" && key !== "s") throw new Error(`fade: unsupported option ${key}`);
    const min = isCount ? 1 : 0;
    const max = isType ? 1 : 2147483647;
    const number = parseFilterExpression(value, "fade", {
      min, max, default: isCount ? 25 : 0, none: 0, all: -1,
      ...(isType ? { in: 0, out: 1 } : {})
    }, undefined, new Float64Array(10));
    if (!Number.isFinite(number) || number < min || number > max) throw new RangeError(`fade: invalid ${key}`);
    const rounded = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    if (isType) type = rounded;
    else if (isCount) count = rounded;
    else startFrame = rounded;
  }
  const black = color[0] === 0 && color[1] === 0 && color[2] === 0 && color[3] === 255;
  const step = Math.floor(65536 / count);
  if (timed) count = 0;
  const registers = new Float64Array(10);
  const randomStates: BigUint64Array[] = [];
  let started = false, done = false, work = 0;
  const output: MediaVideoFrame[] = [];
  for (const [n, input] of frames.entries()) {
    signal?.throwIfAborted();
    budget.checkCpu();
    let frame = input;
    // Fade does not accept packed RGB48. Native negotiates planar YUV444P16,
    // including the conversion on frames outside the fading interval.
    if (black && !alpha && frame.native?.rgba === frame.data && [34, 35].includes(frame.native.format)) {
      budget.allocateMemory(frame.width * frame.height * 10);
      frame = await formatYuv(frame, "yuv444p16le", signal);
    }
    let enabled = true;
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN };
      parseFilterExpression(enable, "fade enable", variables, undefined, registers, randomStates);
      enabled = Math.abs(parseFilterExpression(enable, "fade enable", variables, undefined, registers, randomStates)) >= 0.5;
    }
    if (!enabled) { output.push(frame); continue; }
    const pts = Math.round(frame.ptsSeconds * timescale);
    if (!started && pts >= startTime && n >= startFrame) {
      started = true;
      if (startTime === 0 && startFrame !== 0) startTime = pts;
      if (startTime !== 0 && startFrame === 0) startFrame = n;
    }
    let factor = 0;
    if (started) {
      factor = duration ? Math.trunc((pts - startTime) * 65535 / duration) : (n - startFrame) * step;
      if (duration ? pts > startTime + duration : n > startFrame + count) done = true;
    }
    factor = done ? 65535 : Math.max(0, Math.min(65535, factor));
    if (type === 1) factor = 65535 - factor;
    if (factor === 65535) { output.push(frame); continue; }
    const retained = frame.native;
    const native = retained?.rgba === frame.data && retained.width === frame.width && retained.height === frame.height ? retained : undefined;
    const planar = native && [0, 4, 5, 12, 13, 14, 33, 45, 49, 62, 68, 79].includes(native.format) && black ? native : undefined;
    const gray = native && [8, 29, 30].includes(native.format) && black && !alpha ? native : undefined;
    const source = planar ?? gray;
    const wide = source && [29, 30, 45, 49, 62, 68].includes(source.format);
    const depth = wide ? ([62, 68].includes(source.format) ? 10 : 16) : 8;
    const sampleBytes = wide ? 2 : 1;
    const lumaSize = frame.width * frame.height;
    const hasPlanarAlpha = planar && [33, 79].includes(planar.format);
    const chromaEnd = source ? source.pixels.length / sampleBytes - (hasPlanarAlpha ? lumaSize : 0) : 0;
    budget.allocateMemory((source?.pixels.length ?? frame.data.length) + (source ? frame.data.length : 0));
    const pixels = new Uint8Array(source?.pixels ?? frame.data);
    const view = new DataView(pixels.buffer);
    for (let i = 0; i < pixels.length / sampleBytes; i++) {
      if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const alphaSample = source ? hasPlanarAlpha && i >= chromaEnd : i % 4 === 3;
      if (alpha ? !alphaSample : alphaSample && (source || !black || ["gbrap", "gbrp", "rgb24", "bgr24", "gray", "gray8"].includes(pixelFormat ?? ""))) continue;
      const sample = wide ? view.getUint16(i * 2, source.format !== 29) : pixels[i]!;
      const chroma = planar && i >= lumaSize && i < chromaEnd;
      const base = alpha ? 0 : chroma ? 2 ** (depth - 1)
        : planar ? ([12, 13, 14].includes(planar.format) ? 0 : 16 * 2 ** (depth - 8))
        : source || black ? 0 : color[i % 4]!;
      // Native's 8-bit chroma path uses 8421367, not exactly 128.5 in 16.16.
      const rounding = chroma && !wide ? 32759 : 32768;
      const value = Math.floor(((sample - base) * factor + base * 65536 + rounding) / 65536);
      if (wide) view.setUint16(i * 2, value, source.format !== 29);
      else pixels[i] = value;
    }
    if (source) {
      const faded = { ...source, pixels };
      const data = scaleVideoPicture({ ...frame, native: faded }, frame.width, frame.height)!;
      output.push({ ...frame, data, native: { ...faded, rgba: data } });
    } else {
      const faded = { ...frame, data: pixels };
      delete faded.native;
      output.push(faded);
    }
  }
  return output;
}

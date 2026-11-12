import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";
import { meanFrameDifference } from "./select.js";
import { sceneChangeDifference } from "./scdet.js";
import { formatYuv } from "./format-yuv.js";

export async function interpolateFrameRate(
  frames: MediaVideoFrame[], argument: string, inputTimescale: number,
  pixelFormat: string | undefined, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ frames: MediaVideoFrame[]; timescale: number; frameRate: number; pixelFormat: string | undefined }> {
  const options: Record<string, string> = {};
  const keys = ["fps", "interp_start", "interp_end", "scene", "flags"];
  let position = 0;
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const part of argument ? argument.split(":") : []) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? keys[position++] : part.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    if (key === "threads" || key === "thread_type") {
      validateWeaveGenericOption(key, part.slice(separator + 1).trim(), "framerate");
      continue;
    }
    if (key === "enable") throw new Error("framerate: timeline is unsupported");
    if (!key || !keys.includes(key)) throw new Error(`framerate: unsupported option ${key ?? part}`);
    options[key] = (separator < 0 ? part : part.slice(separator + 1)).trim();
  }
  const frameRate = options.fps === "ntsc-film" ? 24000 / 1001 : parseFilterExpression(options.fps ?? "50", "framerate", {
    ntsc: 30000 / 1001, pal: 25, film: 24,
    qntsc: 30000 / 1001, qpal: 25, sntsc: 30000 / 1001, spal: 25
  });
  if (frameRate <= 0 || frameRate > 2147483647) throw new Error("framerate: invalid frame rate");
  const values = ["interp_start", "interp_end", "scene"].map((key, index) => {
    const defaults = [15, 240, 8.2];
    const max = [255, 255, 100][index]!;
    const value = parseFilterExpression(options[key] ?? String(defaults[index]), "framerate", {
      default: defaults[index]!, min: 0, max
    });
    if (value < 0 || value > max) throw new RangeError(`framerate: ${key} out of range`);
    if (key === "scene") return value;
    const lower = Math.floor(value);
    return value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  });
  const [interpStart, interpEnd, scene] = values as [number, number, number];
  const expression = options.flags ?? "1";
  let flags = expression.startsWith("+") || expression.startsWith("-") ? 1 : 0;
  let offset = 0;
  do {
    const remove = expression[offset] === "-";
    if (remove || expression[offset] === "+") offset++;
    const start = offset;
    if (expression[offset] === "+" || expression[offset] === "-") offset++;
    while (offset < expression.length && expression[offset] !== "+" && expression[offset] !== "-") offset++;
    const bits = parseFilterExpression(expression.slice(start, offset), "framerate", {
      scd: 1, scene_change_detect: 1, none: 0, all: -1, default: 1, min: 0, max: 2147483647
    });
    if (!Number.isInteger(bits) || bits < -2147483648 || bits > 4294967295) {
      throw new RangeError("framerate: flags out of range");
    }
    flags = remove ? flags & ~bits : flags | bits;
  } while (offset < expression.length);

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
  const gray = pixelFormat === "gray" || pixelFormat === "gray8" || pixelFormat === "ya8";
  const gray16 = pixelFormat === "gray16le" || pixelFormat === "gray16be";
  const rgb = ["rgb24", "bgr24", "rgba", "bgra", "gbrp", "gbrap"].includes(pixelFormat ?? "");
  const outputFormat = gray ? "yuvj444p" : rgb || pixelFormat === "yuva444p" ? "yuv444p"
    : pixelFormat === "yuva420p" ? "yuv420p" : pixelFormat;
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
        // Native uses seven-bit weights for bytes and fifteen-bit weights for
        // wide samples. Interpolation thresholds always use eight-bit positions.
        const wide = previous.native!.format >= 49;
        const maximum = wide ? 32768 : 128;
        const factor = Math.round((pts - previous.ptsSeconds) * maximum / delta);
        const position = Math.round((pts - previous.ptsSeconds) * 256 / delta);
        if (factor >= maximum || position > interpEnd) frame = next;
        else if (factor <= 0 || position < interpStart) frame = previous;
        else {
          if (score === undefined && (flags & 1)) {
            // Converted frames have padded planes. Native FFmpeg 7's narrow-row
            // SAD compares their luma row twice below 32px, without chroma bytes.
            let difference = outputFormat !== pixelFormat
              ? await meanFrameDifference(next, previous, pixelFormat, budget, signal) * 100 / 256 * (next.width < 32 ? 2 : 1)
              : wide ? 0 : await sceneChangeDifference(next, previous, pixelFormat, budget, signal);
            if (wide) {
              const source = new DataView(previous.native!.pixels.buffer, previous.native!.pixels.byteOffset, previous.native!.pixels.byteLength);
              const target = new DataView(next.native!.pixels.buffer, next.native!.pixels.byteOffset, next.native!.pixels.byteLength);
              const size = next.width * next.height;
              for (let i = 0; i < size; i++) {
                if (i % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
                difference += Math.abs(source.getUint16(i * 2, true) - target.getUint16(i * 2, true));
              }
              difference *= 100 / size / (gray16 ? 65536 : 1024);
            }
            score = Math.fround(Math.min(difference, Math.abs(difference - previousDifference), 100));
            previousDifference = difference;
          }
          frame = factor > maximum / 2 ? next : previous;
          if ((score ?? 0) < scene) {
            const source = previous.native!, target = next.native!;
            budget.allocateMemory(source.pixels.length + previous.data.length);
            const pixels = new Uint8Array(source.pixels.length);
            const sourceView = new DataView(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength);
            const targetView = new DataView(target.pixels.buffer, target.pixels.byteOffset, target.pixels.byteLength);
            const outputView = new DataView(pixels.buffer);
            for (let i = 0; i < pixels.length; i += wide ? 2 : 1) {
              if (i % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
              if (wide) {
                // Negotiated 12-bit grayscale luma is stored in 16-bit YUV planes.
                const shift = gray16 ? 4 : 0;
                const first = sourceView.getUint16(i, true) >> shift;
                const second = targetView.getUint16(i, true) >> shift;
                outputView.setUint16(i, Math.floor((first * (maximum - factor) + second * factor + maximum / 2) / maximum) << shift, true);
              } else pixels[i] = (source.pixels[i]! * (128 - factor) + target.pixels[i]! * factor + 64) >> 7;
            }
            const native = { ...source, pixels };
            const data = scaleVideoPicture({ ...previous, native }, previous.width, previous.height)!;
            frame = { ...previous, data, native: { ...native, rgba: data } };
          }
        }
      }
      if (gray16) {
        const source = frame.native!;
        const view = new DataView(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength);
        budget.allocateMemory(frame.width * frame.height * 2 + frame.data.length);
        const pixels = new Uint8Array(frame.width * frame.height * 2);
        const outputView = new DataView(pixels.buffer);
        for (let i = 0; i < pixels.length; i += 2) {
          if (i % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          // swscale expands limited-range luma at 19-bit precision.
          const luma = view.getUint16(i, true) * 8;
          const value = (Math.floor((Math.min(luma, 30189 * 16) * 4769 - 156229444) / 4096) + 4) >> 3;
          outputView.setUint16(i, Math.max(0, Math.min(65535, value)), pixelFormat === "gray16le");
        }
        const native = { ...source, pixels, format: pixelFormat === "gray16le" ? 30 : 29, fullRange: 1 };
        const data = scaleVideoPicture({ ...frame, native }, frame.width, frame.height)!;
        frame = { ...frame, data, native: { ...native, rgba: data } };
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
    if (gray16) {
      const source = frame.native;
      if (!source || source.rgba !== frame.data || ![29, 30].includes(source.format)) {
        throw new Error("framerate: requires retained 16-bit grayscale samples");
      }
      const size = frame.width * frame.height;
      budget.allocateMemory(size * 6);
      const pixels = new Uint8Array(size * 6);
      const view = new DataView(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength);
      const outputView = new DataView(pixels.buffer);
      for (let i = 0; i < size * 3; i++) {
        if (i % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        // Native negotiates grayscale to limited-range YUV444P12. Retain its
        // quantized samples in the existing 16-bit planar representation.
        const value = i < size
          ? (((((view.getUint16(i * 2, source.format === 30) >> 1) * 14071 + 33561947) >> 14) + 4) >> 3) << 4
          : 32768;
        outputView.setUint16(i * 2, value, true);
      }
      frame = { ...frame, native: { ...source, pixels, format: 49, fullRange: 0 } };
    } else if (gray) {
      const size = frame.width * frame.height;
      budget.allocateMemory(size * 3);
      const pixels = new Uint8Array(size * 3).fill(128);
      for (let i = 0; i < size; i++) {
        if (i % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        pixels[i] = frame.data[i * 4]!;
      }
      const native = { pixels, width: frame.width, height: frame.height,
        format: 14, fullRange: 1, colorspace: 5, rgba: frame.data };
      let data = frame.data;
      if (pixelFormat === "ya8") {
        budget.allocateMemory(data.length);
        data = scaleVideoPicture({ ...frame, native }, frame.width, frame.height)!;
      }
      frame = { ...frame, data, native: { ...native, rgba: data } };
    } else if (rgb) {
      budget.allocateMemory(frame.width * frame.height * 7);
      frame = await formatYuv(frame, "yuv444p", signal);
    } else if (frame.native?.rgba === frame.data && [33, 79].includes(frame.native.format)) {
      // Drop the alpha plane without a lossy round trip through clipped RGB.
      const native = { ...frame.native, format: frame.native.format === 33 ? 0 : 5,
        pixels: frame.native.pixels.subarray(0, frame.native.pixels.length - frame.width * frame.height) };
      budget.allocateMemory(frame.data.length);
      const data = scaleVideoPicture({ ...frame, native }, frame.width, frame.height)!;
      frame = { ...frame, data, native: { ...native, rgba: data } };
    }
    if (!frame.native || frame.native.rgba !== frame.data ||
        ![0, 4, 5, 12, 13, 14, 62, 68, ...(gray16 ? [49] : [])].includes(frame.native.format)) {
      throw new Error("framerate: supported input is 8/16-bit grayscale or 8/10-bit planar YUV");
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
  return { frames: result, timescale, frameRate, pixelFormat: outputFormat };
}

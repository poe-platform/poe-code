import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

// Wavelet coefficients and denoising algorithm from FFmpeg af_afwtdn.c,
// Copyright (c) 2020 Paul B Mahol, LGPL-2.1-or-later.
// https://github.com/FFmpeg/FFmpeg/blob/n7.0.2/libavfilter/af_afwtdn.c
const wavelets = {
  sym2: [
    -0.12940952255092145, 0.22414386804185735, 0.836516303737469, 0.48296291314469025,
  ],
  sym4: [
    -0.07576571478927333, -0.02963552764599851, 0.49761866763201545, 0.8037387518059161,
    0.29785779560527736, -0.09921954357684722, -0.012603967262037833, 0.0322231006040427,
  ],
  rbior68: [
    0.0, 0.0, 0.0, 0.0,
    0.014426282505624435, 0.014467504896790148, -0.07872200106262882, -0.04036797903033992,
    0.41784910915027457, 0.7589077294536541, 0.41784910915027457, -0.04036797903033992,
    -0.07872200106262882, 0.014467504896790148, 0.014426282505624435, 0.0,
    0.0, 0.0,
  ],
  deb10: [
    -1.326420300235487e-05, 9.358867000108985e-05, -0.0001164668549943862, -0.0006858566950046825,
    0.00199240529499085, 0.0013953517469940798, -0.010733175482979604, 0.0036065535669883944,
    0.03321267405893324, -0.02945753682194567, -0.07139414716586077, 0.09305736460380659,
    0.12736934033574265, -0.19594627437659665, -0.24984642432648865, 0.2811723436604265,
    0.6884590394525921, 0.5272011889309198, 0.18817680007762133, 0.026670057900950818,
  ],
  sym10: [
    0.0007701598091144901, 9.563267072289475e-05, -0.008641299277022422, -0.0014653825813050513,
    0.0459272392310922, 0.011609893903711381, -0.15949427888491757, -0.07088053578324385,
    0.47169066693843925, 0.7695100370211071, 0.38382676106708546, -0.03553674047381755,
    -0.0319900568824278, 0.04999497207737669, 0.005764912033581909, -0.02035493981231129,
    -0.0008043589320165449, 0.004593173585311828, 5.7036083618494284e-05, -0.0004593294210046588,
  ],
  coif5: [
    -9.517657273819165e-08, -1.6744288576823017e-07, 2.0637618513646814e-06, 3.7346551751414047e-06,
    -2.1315026809955787e-05, -4.134043227251251e-05, 0.00014054114970203437, 0.00030225958181306315,
    -0.0006381313430451114, -0.0016628637020130838, 0.0024333732126576722, 0.006764185448053083,
    -0.009164231162481846, -0.01976177894257264, 0.03268357426711183, 0.0412892087501817,
    -0.10557420870333893, -0.06203596396290357, 0.4379916261718371, 0.7742896036529562,
    0.4215662066908515, -0.05204316317624377, -0.09192001055969624, 0.02816802897093635,
    0.023408156785839195, -0.010131117519849788, -0.004159358781386048, 0.0021782363581090178,
    0.00035858968789573785, -0.00021208083980379827,
  ],
  bl3: [
    0.000146098, -0.000232304, -0.000285414, 0.000462093,
    0.000559952, -0.000927187, -0.001103748, 0.00188212,
    0.002186714, -0.003882426, -0.00435384, 0.008201477,
    0.008685294, -0.017982291, -0.017176331, 0.042068328,
    0.032080869, -0.110036987, -0.050201753, 0.433923147,
    0.766130398, 0.433923147, -0.050201753, -0.110036987,
    0.032080869, 0.042068328, -0.017176331, -0.017982291,
    0.008685294, 0.008201477, -0.00435384, -0.003882426,
    0.002186714, 0.00188212, -0.001103748, -0.000927187,
    0.000559952, 0.000462093, -0.000285414, -0.000232304,
    0.000146098, 0.0,
  ],
};
const rbior68Inverse = [
  0.0019088317364812906, -0.0019142861290887667, -0.016990639867602342, 0.01193456527972926,
  0.04973290349094079, -0.07726317316720414, -0.09405920349573646, 0.4207962846098268,
  0.8259229974584023, 0.4207962846098268, -0.09405920349573646, -0.07726317316720414,
  0.04973290349094079, 0.01193456527972926, -0.016990639867602342, -0.0019142861290887667,
  0.0019088317364812906, 0.0,
];
export async function denoiseWavelets(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  filter: string, frames: readonly { start: number; end: number; pts: number }[],
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ channels: Float64Array[]; frames: { start: number; end: number; pts: number }[] }> {
  const options = { sigma: 0, levels: 10, wavet: 4, percent: 85, profile: 0, adaptive: 0, samples: 8192, softness: 1 };
  const ranges = { sigma: [0, 1], levels: [1, 12], wavet: [0, 6], percent: [0, 100],
    profile: [0, 1], adaptive: [0, 1], samples: [512, 65536], softness: [0, 10] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const waveletNames = Object.keys(wavelets) as (keyof typeof wavelets)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let positional = 0;
  for (const part of argument ? argument.split(":") : []) {
    const separator = part.indexOf("=");
    const key = (separator < 0 ? names[positional++] : part.slice(0, separator).trim()) as keyof typeof options | "threads" | "thread_type" | "extra_hw_frames";
    const raw = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, raw, "afwtdn");
      continue;
    }
    if (!names.includes(key)) throw new Error(`afwtdn: unsupported option ${key}`);
    const boolean = key === "profile" || key === "adaptive";
    const digits = raw.startsWith("+") || raw.startsWith("-") ? raw.slice(1) : raw;
    const booleanWords = ["true", "yes", "on", "y", "enable", "enabled", "false", "no", "off", "n", "disable", "disabled", ""];
    if (boolean && !booleanWords.includes(raw.toLowerCase()) &&
      (!digits.length || ![...digits].every(char => char >= "0" && char <= "9"))) throw new Error(`afwtdn: invalid ${key}`);
    const value = boolean && ["true", "yes", "on", "y", "enable", "enabled"].includes(raw.toLowerCase()) ? 1
      : boolean && ["false", "no", "off", "n", "disable", "disabled", ""].includes(raw.toLowerCase()) ? 0
      : parseFilterExpression(raw, "afwtdn", key === "wavet" ? Object.fromEntries(waveletNames.map((name, i) => [name, i])) : {});
    const [min, max] = ranges[key];
    if ((!raw && !boolean) || !Number.isFinite(value)) throw new Error(`afwtdn: invalid ${key}`);
    if (value < min! || value > max!) {
      if (boolean) throw new Error(`afwtdn: invalid ${key}`);
      throw new RangeError(`afwtdn: invalid ${key}`);
    }
    const floor = Math.floor(value);
    options[key] = ["levels", "wavet", "samples"].includes(key)
      ? value - floor === 0.5 ? floor + floor % 2 : Math.round(value) : value;
  }
  const name = waveletNames[options.wavet]!;
  const lp = wavelets[name];
  const ilp = name === "rbior68" ? rbior68Inverse : [...lp].reverse();
  const hp = ilp.map((value, i) => i % 2 === 0 ? -value : value);
  const ihp = lp.map((value, i) => i % 2 === 0 ? value : -value);
  const taps = lp.length;
  const size = options.samples;
  const levels = Math.min(options.levels, Math.round(Math.log2(size / (taps - 1))));
  const period = 2 ** levels;
  const overlapSize = (period - 1) * (taps - 1);
  const capacity = size + overlapSize + taps;
  const length = channels[0]?.length ?? 0;
  // Native emits the padded last input window before trimming its EOF flush.
  // A partial first window consumed entirely by startup delay emits no audio.
  const outputLength = length < size && overlapSize >= size ? 0
    : Math.max(length, Math.ceil(length / size) * size - overlapSize);
  const bandSizes = Array.from({ length: levels + 1 }, (_, level) => Math.ceil(size / 2 ** Math.min(level + 1, levels)));
  const scratchBytes = (capacity * 3 + overlapSize + bandSizes.reduce((sum, n) => sum + n, 0) + (levels + 1) * 4) * 8;
  budget.allocateMemory(outputLength * channels.length * 8 + scratchBytes);
  const output = channels.map(() => new Float64Array(outputLength));
  const outputFrames: { start: number; end: number; pts: number }[] = [];
  let frameIndex = 0;
  let nextPts = 0;
  // Reuse bounded scratch space across windows and channels.
  const buffers = [new Float64Array(capacity), new Float64Array(capacity), new Float64Array(capacity)];
  const bands = bandSizes.map(size => new Float64Array(size));
  const overlap = new Float64Array(overlapSize);
  const deviation = new Float64Array(levels + 1), absmean = new Float64Array(levels + 1);
  const measuredDeviation = new Float64Array(levels + 1), measuredAbsmean = new Float64Array(levels + 1);
  const mix = options.percent * 0.01;
  try {
    for (const [c, channel] of channels.entries()) {
      overlap.fill(0); deviation.fill(0); absmean.fill(0);
      // Native starts the decimation phase at sample 1, pads with silence and
      // discards the transform delay. Keep the same phase for non-power-of-two windows.
      for (let start = 0; start < outputLength + overlapSize; start += size) {
        await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
        if (c === 0) {
          // Consume fixed-size windows independently of upstream packet boundaries.
          // Startup drops the transform delay; EOF can emit a shorter flush frame.
          while (frameIndex + 1 < frames.length && frames[frameIndex]!.end <= start) frameIndex++;
          const frame = frames[frameIndex];
          const pts = start < length
            ? (frame ? frame.pts + start - frame.start : start) - Math.min(start, overlapSize)
            : nextPts;
          const from = Math.max(0, start - overlapSize);
          const end = Math.min(outputLength, start + size - overlapSize);
          if (end > from) {
            budget.allocateMemory(24);
            outputFrames.push({ start: from, end, pts });
            nextPts = pts + end - from;
          }
        }
        const sn = start + 1;
        const extension = (period - 1) * (taps - 2) + sn % period;
        const counts = bandSizes.map((_, level) => {
          const scale = 2 ** Math.min(level + 1, levels);
          return Math.floor((sn + size) / scale) - Math.floor(sn / scale);
        });
        let current = buffers[0]!, next = buffers[1]!;
        const high = buffers[2]!;
        current.fill(0);
        for (let i = 0; i < size + extension; i++) current[i] = channel[start - extension + i] ?? 0;
        for (let level = 0; level < levels; level++) {
          const discard = level + 1 === levels ? 0
            : (2 ** (levels - level - 1) - 1) * (taps - 2) + Math.floor(sn % period / 2 ** (level + 1));
          const count = counts[level]! + discard;
          for (let i = 0; i < count; i++) {
            if (i % 2048 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            let lowSum = 0, highSum = 0;
            for (let j = 0; j < taps; j++) {
              const value = current[2 * i + taps - 1 - j]!;
              lowSum += value * lp[j]!;
              highSum += value * hp[j]!;
            }
            next[i] = lowSum;
            high[i] = highSum;
          }
          next.fill(0, count);
          bands[level]!.set(high.subarray(discard, count));
          [current, next] = [next, current];
        }
        bands[levels]!.set(current.subarray(0, counts[levels]));

        let noise = 0;
        for (let level = 0; level <= levels; level++) {
          const band = bands[level]!;
          const count = counts[level]!;
          let sum = 0, absolute = 0, variance = 0;
          for (let i = 0; i < count; i++) { sum += band[i]!; absolute += Math.abs(band[i]!); }
          const mean = sum / count;
          for (let i = 0; i < count; i++) variance += (band[i]! - mean) ** 2;
          measuredDeviation[level] = Math.sqrt(variance / count);
          measuredAbsmean[level] = absolute / count;
          const scale = Math.sqrt(2 * Math.log(count));
          if (options.profile && start === 0) {
            deviation[level] = measuredDeviation[level]! * scale;
            absmean[level] = measuredAbsmean[level]! * scale;
          } else if (!options.profile && !options.adaptive) {
            deviation[level] = absmean[level] = 0.5 * options.sigma * scale;
          }
          const vad = measuredAbsmean[level]! <= 2 ** -23 ? 1 : measuredDeviation[level]! / measuredAbsmean[level]!;
          if (level < levels) noise += (vad - 1.232) ** 2;
        }
        noise *= sampleRate / size;
        for (let level = 0; level <= levels; level++) {
          const count = counts[level]!;
          if (options.adaptive && noise < 0.05) {
            const scale = Math.sqrt(2 * Math.log(count));
            deviation[level] = measuredDeviation[level]! * scale;
            absmean[level] = measuredAbsmean[level]! * scale;
          }
          const threshold = absmean[level]!;
          const band = bands[level]!;
          for (let i = 0; i < count; i++) {
            if (i % 2048 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const value = band[i]!;
            const filtered = measuredDeviation[level]! <= deviation[level]! || Math.abs(value) <= threshold ? 0
              : value - Math.sign(value) * threshold / Math.exp(3 * options.softness * (Math.abs(value) - threshold) / threshold);
            band[i] = mix * filtered + value * (1 - mix);
          }
        }

        current = bands[levels]!;
        for (let level = levels - 1; level >= 0; level--) {
          const add = (2 ** (levels - level - 1) - 1) * (taps - 2) + Math.floor(sn % period / 2 ** (level + 1));
          const outputCount = level === 0 ? size + overlapSize
            : counts[level - 1]! + (2 ** (levels - level) - 1) * (taps - 2) + Math.floor(sn % period / 2 ** level);
          next = current === buffers[0] ? buffers[1]! : buffers[0]!;
          const band = bands[level]!;
          const inputCount = counts[level]! + add;
          for (let i = 0; i < outputCount; i++) {
            if (i % 2048 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            let sum = 0;
            const parity = i % 2;
            for (let j = 0; j < taps / 2; j++) {
              const k = Math.floor(i / 2) - j;
              if (k >= 0 && k < inputCount) {
                sum += current[k]! * ilp[2 * j + parity]! + (k >= add ? band[k - add]! : 0) * ihp[2 * j + parity]!;
              }
            }
            next[i] = sum;
          }
          current = next;
        }
        const offset = overlapSize - extension;
        if (overlapSize <= size) {
          for (let i = 0; i < size; i++) {
            const position = start + i - overlapSize;
            if (position >= 0 && position < outputLength) output[c]![position] = (i >= offset ? current[i - offset]! : 0) + (i < overlapSize ? overlap[i]! : 0);
          }
          overlap.set(current.subarray(size - offset, size - offset + overlapSize));
        } else {
          for (let i = 0; i < overlapSize - offset; i++) overlap[i + offset] = overlap[i + offset]! + current[i]!;
          for (let i = 0; i < size; i++) {
            const position = start + i - overlapSize;
            if (position >= 0 && position < outputLength) output[c]![position] = overlap[i]!;
          }
          overlap.copyWithin(0, size);
          overlap.set(current.subarray(extension, extension + size), overlapSize - size);
        }
      }
    }
    return { channels: output, frames: outputFrames };
  } finally {
    budget.releaseMemory(scratchBytes);
  }
}

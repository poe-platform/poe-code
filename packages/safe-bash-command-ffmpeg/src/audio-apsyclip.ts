import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { transform } from "./audio-fft.js";

export async function psychoacousticClip(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  filter: string, budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<{ channels: Float32Array[]; frameSize: number }> {
  const options = { level_in: 1, level_out: 1, clip: 1, diff: 0, adaptive: 0.5, iterations: 10, level: 0 };
  const ranges = { level_in: [0.015625, 64], level_out: [0.015625, 64], clip: [0.015625, 1], diff: [0, 1], adaptive: [0, 1], iterations: [1, 20], level: [0, 1] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim() as keyof typeof options;
    if (!key || !Object.hasOwn(options, key)) throw new Error(`apsyclip: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const boolean = key === "diff" || key === "level";
    const number = boolean && ["true", "yes", "on"].includes(value) ? 1
      : boolean && ["false", "no", "off"].includes(value) ? 0 : Number(value);
    const [min, max] = ranges[key];
    if (!value || !Number.isFinite(number) || number < min! || number > max! || ((boolean || key === "iterations") && !Number.isInteger(number))) {
      throw new Error(`apsyclip: invalid ${key}`);
    }
    options[key] = number;
  }
  const size = sampleRate > 100000 ? 1024 : sampleRate > 50000 ? 512 : 256;
  const hop = size / 4, delay = size - hop, bins = 128;
  const length = channels[0]?.length ?? 0;
  // Output plus reusable transform/window workspace and the bounded spreading matrix.
  budget.allocateMemory(channels.length * length * 4 + size * 80 + bins * bins * 4);
  const output = channels.map(() => new Float32Array(length));
  const window = Float32Array.from({ length: size }, (_, i) => 0.5 * (1 - Math.fround(Math.cos(Math.fround(2 * Math.PI * i / size)))));
  const inverse = window.map(value => value > 0.1 ? 1 / value : 0);
  const points = [[0, 14], [125, 14], [250, 16], [500, 18], [1000, 20], [2000, 20], [4000, 20], [8000, 17], [16000, 14], [20000, -10]];
  const margin = Float32Array.from({ length: size / 2 + 1 }, (_, i) => {
    const hz = Math.trunc(i * sampleRate / size);
    const next = points.findIndex(point => point[0]! > hz);
    if (next < 0) return 10 ** (-10 / 20);
    const [x, y] = points[Math.max(0, next - 1)]!;
    const [nx, ny] = points[next]!;
    return 10 ** ((y! + Math.trunc((hz - x!) * (ny! - y!) / (nx! - x!))) / 20);
  });
  const spread = new Float32Array(bins * bins);
  let anchor = 0, step = 1;
  for (let bin = 0; bin < bins; bin++) {
    if (bin === anchor + step) {
      anchor = bin;
      if (anchor > 1 && (anchor & (anchor - 1)) === 0) step = anchor / 2;
    }
    const low = Math.floor(anchor * 3 / 4), high = Math.min(bins, Math.floor(((anchor + 1) * 4 + 2) / 3));
    let sum = 0;
    for (let j = low; j < high; j++) sum += Math.exp(-Math.abs(Math.log((j + 0.5) / (anchor + 0.5))) * (j >= anchor ? 40 : 80));
    for (let j = low; j < high; j++) {
      const target = bin + j - anchor;
      if (target >= 0 && target < bins) spread[bin * bins + target] = Math.exp(-Math.abs(Math.log((j + 0.5) / (anchor + 0.5))) * (j >= anchor ? 40 : 80)) / sum;
    }
  }
  const input = new Float32Array(size), overlap = new Float32Array(size), framed = new Float32Array(size);
  const delta = new Float32Array(size), mask = new Float32Array(size / 2 + 1);
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  for (const [c, channel] of channels.entries()) {
    let nextCommand = 0;
    let levelOut = options.level_out, diff = options.diff;
    input.fill(0); overlap.fill(0);
    for (let start = 0; start < length; start += hop) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      while (nextCommand < commands.length && commands[nextCommand]!.sample <= start) {
        const { action, expression } = commands[nextCommand++]!;
        const value = expression.trim();
        const number = action === "diff" && ["true", "yes", "on"].includes(value) ? 1
          : action === "diff" && ["false", "no", "off"].includes(value) ? 0 : Number(value);
        if (!value || !Number.isFinite(number)) continue;
        if (action === "level_out" && number >= ranges.level_out[0]! && number <= ranges.level_out[1]!) levelOut = number;
        else if (action === "diff" && (number === 0 || number === 1)) diff = number;
      }
      input.copyWithin(0, hop); overlap.copyWithin(0, hop); overlap.fill(0, delay);
      for (let i = 0; i < hop; i++) input[delay + i] = (channel[start + i] ?? 0) * options.level_in;
      for (let i = 0; i < size; i++) framed[i] = input[i]! * window[i]!;
      real.set(framed); imaginary.fill(0); transform(real, imaginary);
      mask.fill(0);
      for (let i = 0; i <= size / 2; i++) {
        const magnitude = i === 0 || i === size / 2 ? Math.abs(real[i]!) : 2 * Math.hypot(real[i]!, imaginary[i]!);
        if (i >= bins) mask[i] = magnitude;
        else for (let j = 0; j < bins; j++) mask[j] = mask[j]! + spread[i * bins + j]! * magnitude;
      }
      for (let i = 0; i < mask.length; i++) mask[i] = mask[i]! / margin[i]!;
      let originalPeak = 0;
      for (let i = 0; i < size; i++) originalPeak = Math.max(originalPeak, Math.abs(framed[i]! * inverse[i]!));
      originalPeak /= options.clip;
      let peak = originalPeak;
      delta.fill(0);
      for (let iteration = 0; iteration < options.iterations; iteration++) {
        const finalRounds = options.iterations - Math.floor(options.iterations / 3);
        const boost = iteration >= finalRounds && peak < 2 ? 2 : 1;
        for (let i = 0; i < size; i++) {
          const limit = options.clip * window[i]!;
          const value = Math.fround(framed[i]! + delta[i]!);
          delta[i] = delta[i]! + (Math.max(-limit, Math.min(limit, value)) - value) * boost;
        }
        real.set(delta); imaginary.fill(0); transform(real, imaginary);
        for (let i = 0; i <= size / 2; i++) {
          const edge = i === 0 || i === size / 2;
          const ratio = (edge ? Math.abs(real[i]!) : 2 * Math.hypot(real[i]!, imaginary[i]!)) / mask[i]!;
          if (ratio > 1) {
            real[i] = real[i]! / ratio; imaginary[i] = imaginary[i]! / ratio;
            if (!edge) { real[size - i] = real[size - i]! / ratio; imaginary[size - i] = imaginary[size - i]! / ratio; }
          }
        }
        transform(real, imaginary, true);
        peak = 0;
        for (let i = 0; i < size; i++) {
          delta[i] = real[i]! / size;
          peak = Math.max(peak, Math.abs((framed[i]! + delta[i]!) * inverse[i]!));
        }
        peak /= options.clip;
        let shift = 1.122;
        if (originalPeak > 1 && peak > 1) {
          const achieved = originalPeak - peak;
          shift = Math.max(shift, iteration + 1 < finalRounds && achieved > 0 ? Math.min((originalPeak - 1) / achieved, peak) : peak);
        }
        shift = 1 + (shift - 1) * options.adaptive;
        for (let i = 0; i < mask.length; i++) mask[i] = mask[i]! * shift;
      }
      for (let i = 0; i < size; i++) overlap[i] = overlap[i]! + delta[i]! * window[i]!;
      for (let i = 0; i < Math.min(hop, length - start); i++) {
        let value = Math.fround(overlap[i]! / 1.5);
        if (!diff) value = Math.fround(value + input[i]!);
        if (options.level) value = Math.fround(value / options.clip);
        output[c]![start + i] = value * levelOut;
      }
    }
  }
  return { channels: output, frameSize: hop };
}

import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { transform } from "./audio-fft.js";
import { parseFilterExpression } from "./filter-expression.js";

// White-noise spectral subtraction and Bark-band masking from FFmpeg
// af_afftdn.c (LGPL-2.1-or-later), Copyright (c) 2018 The FFmpeg Project.
// https://github.com/FFmpeg/FFmpeg/blob/n7.0.2/libavfilter/af_afftdn.c
export async function denoiseFft(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  filter: string, double: boolean, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ channels: (Float32Array | Float64Array)[]; frameSize: number }> {
  let reduction = 12, floor = -50, mode = 1;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const entries = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) entries.pop();
  for (const [index, part] of entries.entries()) {
    const equals = part.indexOf("=");
    const key = equals < 0 ? ["nr", "nf"][index] : part.slice(0, equals).trim();
    const raw = (equals < 0 ? part : part.slice(equals + 1)).trim();
    if (key === "nr" || key === "noise_reduction" || key === "nf" || key === "noise_floor") {
      const noiseFloor = key === "nf" || key === "noise_floor";
      const min = noiseFloor ? -80 : 0.01, max = noiseFloor ? -20 : 97;
      const value = parseFilterExpression(raw, "afftdn", { min, max, default: noiseFloor ? -50 : 12 });
      if (value < min || value > max) throw new RangeError(`afftdn: invalid ${key}`);
      if (noiseFloor) floor = Math.fround(value);
      else reduction = Math.fround(value);
    } else if (key === "om" || key === "output_mode") {
      const value = parseFilterExpression(raw, "afftdn", { input: 0, i: 0, output: 1, o: 1, noise: 2, n: 2, min: 0, max: 2, default: 1 });
      if (value < 0 || value > 2) throw new RangeError("afftdn: invalid output_mode");
      mode = value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);
    } else throw new Error(`afftdn: unsupported option ${key}`);
  }
  const hop = Math.trunc(sampleRate / 80), length = channels[0]?.length ?? 0;
  if (hop < 1) throw new Error("afftdn: sample rate must be at least 80 Hz");
  const windowLength = 3 * hop, size = 2 ** (Math.floor(Math.log2(windowLength)) + 1);
  const bins = size / 2 + 1, multiplier = 1.25;
  // Output, window/overlap, FFT planes, per-bin state and a bounded Bark matrix.
  // The Bark scale approaches 26 bands; multiplier 1.25 needs at most 34.
  budget.allocateMemory(channels.length * length * (double ? 8 : 4) + windowLength * 16
    + size * 16 + bins * 20 + 34 * 7 * 8 + 34 * 34 * 8);
  signal?.throwIfAborted(); budget.checkCpu();
  const output = channels.map(() => double ? new Float64Array(length) : new Float32Array(length));
  const binBand = Int32Array.from({ length: bins }, (_, i) => {
    const frequency = 0.5 * i * sampleRate / size;
    const bark = 13 * Math.atan(0.00076 * frequency) + 3.5 * Math.atan((frequency / 7500) ** 2);
    return Math.round(multiplier * bark);
  });
  const bands = binBand[bins - 1]! + 1;
  const spread = new Float64Array(bands * bands), counts = new Float64Array(bands);
  const priorBand = new Float64Array(bands), excitation = new Float64Array(bands);
  const amount = new Float64Array(bands), alpha = new Float64Array(bands), beta = new Float64Array(bands);
  for (const band of binBand) counts[band] = counts[band]! + 1;
  const p1 = 0.1 ** (2.5 / multiplier), p2 = 0.1 ** (1 / multiplier);
  for (let j = 0; j < bands; j++) {
    for (let k = 0; k < bands; k++) {
      const value = k < j ? p2 ** (j - k) : p1 ** (k - j);
      spread[j * bands + k] = value;
      priorBand[j] = priorBand[j]! + value * counts[k]!;
    }
    const threshold = Math.max(0.1 ** 2.5, Math.min(0.1, j < Math.round(12 * multiplier)
      ? 0.1 ** (1.45 + 0.1 * j / multiplier) : 0.1 ** (2.5 - 0.2 * (j / multiplier - 14))));
    for (let k = 0; k < bands; k++) spread[j * bands + k] = spread[j * bands + k]! * threshold / priorBand[j]!;
  }
  for (let i = 0, band = 0; i < bins; i++) {
    if (binBand[i]! > band) {
      const frequency = (i - 1) * sampleRate / size;
      alpha[band] = Math.exp(-(hop / sampleRate) / Math.min(0.008 + 2.2 / frequency, 0.03));
      beta[band] = 1 - alpha[band]!;
      band = binBand[i]!;
    }
  }
  const initialBand = priorBand.slice();
  const window = new Float64Array(windowLength), overlap = new Float64Array(windowLength);
  const scale = Math.sqrt(8 / (9 * size));
  let windowWeight = 0;
  for (let i = 0; i < windowLength; i++) {
    const sine = Math.sin(i * Math.PI / windowLength);
    window[i] = sine * (scale * sine);
    windowWeight += window[i]! * window[i]!;
  }
  const variance = Math.max(2 ** 48 * Math.exp(-23.025558369790467) * 0.5 * windowWeight
    * Math.exp((100 + floor) * (Math.LN10 * 0.1)), 1);
  const maxGain = Math.exp(reduction * (0.5 * Math.LN10 * 0.1));
  const minVariance = variance / (maxGain * maxGain);
  const prior = new Float64Array(bins), gain = new Float64Array(bins);
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  for (const [c, channel] of channels.entries()) {
    prior.fill(0); priorBand.set(initialBand); overlap.fill(0);
    for (let start = 0; start < length; start += hop) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      real.fill(0); imaginary.fill(0); excitation.fill(0); amount.fill(0);
      for (let i = 0; i < windowLength; i++) {
        const input = channel[start - 2 * hop + i] ?? 0;
        const value = window[i]! * (double ? input : Math.fround(input)) * 2 ** 23;
        real[i] = double ? value : Math.fround(value);
      }
      transform(real, imaginary);
      const ratio = start === 0 ? 1 : 0.5;
      for (let i = 0; i < bins; i++) {
        if (!double) { real[i] = Math.fround(real[i]!); imaginary[i] = Math.fround(imaginary[i]!); }
        const magnitude = Math.hypot(real[i]!, imaginary[i]!);
        const power = magnitude * magnitude, relative = power / variance;
        const estimate = ratio * prior[i]! + (1 - ratio) * Math.max(relative - 1, 0);
        const value = estimate / (1 + estimate);
        gain[i] = value;
        prior[i] = relative * (value * value);
        const band = binBand[i]!;
        excitation[band] = excitation[band]! + power * (value * value);
      }
      for (let j = 0; j < bands; j++) {
        excitation[j] = Math.max(excitation[j]!, alpha[j]! * excitation[j]! + beta[j]! * priorBand[j]!);
        priorBand[j] = excitation[j]!;
      }
      for (let j = 0; j < bands; j++) for (let k = 0; k < bands; k++) {
        amount[j] = amount[j]! + spread[j * bands + k]! * excitation[k]!;
      }
      for (let i = 0; i < bins; i++) {
        const masking = amount[binBand[i]!]!, value = gain[i]!;
        const limit = masking > minVariance ? Math.sqrt(variance / masking) : maxGain;
        const limited = masking > variance ? 1 : value < 1 ? (limit * value - 2 * value + 1) / (limit - value)
          : value > 1 ? (limit * value - 1) / (limit + value - 2) : 1;
        const applied = double ? limited : Math.fround(limited);
        real[i] = double ? real[i]! * applied : Math.fround(real[i]! * applied);
        imaginary[i] = double ? imaginary[i]! * applied : Math.fround(imaginary[i]! * applied);
        if (i > 0 && i < size / 2) { real[size - i] = real[i]!; imaginary[size - i] = -imaginary[i]!; }
      }
      transform(real, imaginary, true);
      for (let i = 0; i < windowLength; i++) {
        overlap[i] = overlap[i]! + window[i]! * (double ? real[i]! : Math.fround(real[i]!)) / 2 ** 23;
      }
      for (let i = 0; i < Math.min(hop, length - start); i++) {
        const input = channel[start - 2 * hop + i] ?? 0;
        const original = double ? input : Math.fround(input);
        output[c]![start + i] = mode === 0 ? original : mode === 2 ? original - overlap[i]! : overlap[i]!;
      }
      overlap.copyWithin(0, hop); overlap.fill(0, 2 * hop);
    }
  }
  return { channels: output, frameSize: hop };
}

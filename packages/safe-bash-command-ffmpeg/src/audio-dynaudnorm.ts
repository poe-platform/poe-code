import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterBoolean } from "./filter-boolean.js";
import { parseFilterExpression } from "./filter-expression.js";

export function parseDynaudnorm(filter: string, sampleRate: number) {
  let enable: string | undefined;
  let milliseconds = 500;
  let size = 31;
  let peak = 0.95;
  let maxGain = 10;
  let overlap = 0;
  let coupling = true;
  let targetRms = 0;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let positional = 0;
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["f", "g", "p", "m", "r"][positional++] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "n" || key === "coupling") {
      coupling = parseFilterBoolean(value, "dynaudnorm: invalid coupling");
      continue;
    }
    if (key === "enable") {
      enable = value;
      parseFilterExpression(enable, "dynaudnorm enable",
        { n: 0, t: 0, pos: NaN, w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2 }, undefined, new Float64Array(10), []);
      continue;
    }
    // AVOption integers round to nearest, with halfway values going to even.
    if (key === "f" || key === "framelen") {
      const number = parseFilterExpression(value, "dynaudnorm", { min: 10, max: 8000, default: 500 });
      if (number < 10 || number > 8000) throw new Error("dynaudnorm: invalid framelen");
      milliseconds = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    } else if (key === "g" || key === "gausssize") {
      const number = parseFilterExpression(value, "dynaudnorm", { min: 3, max: 301, default: 31 });
      if (number < 3 || number > 301) throw new Error("dynaudnorm: invalid gausssize");
      size = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    } else if (key === "p" || key === "peak") {
      const number = parseFilterExpression(value, "dynaudnorm", { min: 0, max: 1, default: 0.95 });
      if (number < 0 || number > 1) throw new Error("dynaudnorm: invalid peak");
      peak = number;
    } else if (key === "m" || key === "maxgain") {
      const number = parseFilterExpression(value, "dynaudnorm", { min: 1, max: 100, default: 10 });
      if (number < 1 || number > 100) throw new Error("dynaudnorm: invalid maxgain");
      maxGain = number;
    } else if (key === "o" || key === "overlap") {
      const number = parseFilterExpression(value, "dynaudnorm", { min: 0, max: 1, default: 0 });
      if (number < 0 || number > 1) throw new Error("dynaudnorm: invalid overlap");
      overlap = number;
    } else if (key === "r" || key === "targetrms") {
      const number = parseFilterExpression(value, "dynaudnorm", { min: 0, max: 1, default: 0 });
      if (number < 0 || number > 1) throw new Error("dynaudnorm: invalid targetrms");
      targetRms = number;
    } else throw new Error(`dynaudnorm: unsupported option ${key}`);
  }
  // FFmpeg uses even-sized frames and a minimum filter followed by a Gaussian.
  const requested = sampleRate * milliseconds / 1000;
  const rounded = requested % 1 === 0.5 ? 2 * Math.round(requested / 2) : Math.round(requested);
  const windowSize = Math.max(2, rounded + rounded % 2);
  const advance = windowSize * (1 - overlap);
  const frameSize = Math.max(1, advance % 1 === 0.5 ? 2 * Math.round(advance / 2) : Math.round(advance));
  return { enable, size, peak, maxGain, coupling, targetRms, windowSize, frameSize };
}

export async function normalizeAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string, budget: MediaBudgetTracker,
  signal: AbortSignal | undefined, warn: (message: string) => Promise<void>,
  frames?: readonly { start: number; end: number; pts: number; pos?: number | undefined }[], startSample = 0,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<{ channels: Float64Array[]; frameSize: number }> {
  const options = parseDynaudnorm(filter, sampleRate);
  const { enable, maxGain, coupling, targetRms, windowSize, frameSize } = options;
  let { size, peak } = options;
  const variables = { n: 0, t: 0, pos: NaN, w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2 };
  if (size % 2 === 0) {
    await warn(`filter size ${size} is invalid. Changing to an odd value.\n`);
    size++;
  }
  const half = Math.floor(size / 2);
  const length = channels[0]?.length ?? 0;
  const gainChannels = coupling ? 1 : channels.length;
  budget.allocateMemory(length * channels.length * 8 + size * (1 + 3 * gainChannels) * 8 + gainChannels * 16);
  const output = channels.map(() => new Float64Array(length));
  // Preserve FFmpeg's coefficient evaluation order for double-precision frames.
  const sigma = ((size / 2 - 1) / 3) + 1 / 3;
  const scale = 1 / (sigma * Math.sqrt(2 * Math.PI));
  const variance = 2 * sigma * sigma;
  const weights = Array.from({ length: size }, (_, i) => scale * Math.exp(-(i - half) * (i - half) / variance));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const adjust = 1 / total;
  for (let i = 0; i < size; i++) weights[i]! *= adjust;
  // Smoothly cap the gain with maxGain * erf(sqrt(pi) / 2 * gain / maxGain).
  const bound = (gain: number) => {
    if (gain === 0) return 0;
    const x = Math.sqrt(Math.PI) / 2 * (gain / maxGain);
    // erf(6) rounds to 1 in double precision. Below that, use the positive
    // series 2/sqrt(pi) * exp(-x*x) * (x + 2*x^3/3 + 4*x^5/15 + ...).
    // Avoid cancellation and preserve gains at PCM rounding boundaries.
    if (x >= 6) return maxGain;
    let term = x;
    let sum = x;
    for (let n = 1; n < 128; n++) {
      term *= 2 * x * x / (2 * n + 1);
      const next = sum + term;
      if (next === sum) break;
      sum = next;
    }
    return maxGain * (2 / Math.sqrt(Math.PI) * Math.exp(-x * x) * sum);
  };
  const histories = Array.from({ length: gainChannels }, () => ({
    original: [] as number[], minimum: [] as number[], smoothed: [] as number[], previous: 1
  }));
  const magnitudes = new Float64Array(gainChannels);
  const squares = new Float64Array(gainChannels);
  const append = (history: typeof histories[number], gain: number) => {
    const { original, minimum, smoothed } = history;
    if (!original.length) {
      history.previous = Math.min(1, gain);
      for (let i = 0; i < half; i++) original.push(history.previous);
    }
    original.push(gain);
    if (original.length === size) {
      if (!minimum.length) {
        let initial = 1;
        for (let i = 0; i < half; i++) {
          initial = Math.min(initial, original[half + i + 1]!);
          minimum.push(initial);
        }
      }
      minimum.push(Math.min(...original));
      original.shift();
    }
    if (minimum.length === size) {
      smoothed.push(Math.min(original[0]!, minimum.reduce((sum, value, i) => sum + value * weights[i]!, 0)));
      minimum.shift();
    }
  };
  let written = 0;
  let work = 0;
  const registers = new Float64Array(10);
  const randomStates: BigUint64Array[] = [];
  let frameIndex = 0;
  const amplify = async () => {
    const end = Math.min(length, written + frameSize);
    const start = written;
    let enabled = true;
    if (enable !== undefined) {
      while (frames && frameIndex + 1 < frames.length && frames[frameIndex]!.end <= start) frameIndex++;
      const frame = frames?.[frameIndex];
      variables.n = start / frameSize;
      variables.t = (frame ? frame.pts + start - frame.start : startSample + start) / sampleRate;
      variables.pos = frame?.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN;
      // The native activate path evaluates once per consumed normalization frame.
      enabled = Math.abs(parseFilterExpression(enable, "dynaudnorm enable", variables, undefined, registers, randomStates)) >= 0.5;
    }
    for (const [h, history] of histories.entries()) {
      const gain = history.smoothed.shift()!;
      for (let i = written; i < end; i++) {
        const fraction = (i - written + 1) / (end - written);
        const factor = history.previous * (1 - fraction) + gain * fraction;
        for (let c = coupling ? 0 : h; c < (coupling ? channels.length : h + 1); c++) {
          if (++work % 4096 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          output[c]![i] = channels[c]![i]! * (enabled ? factor : 1);
        }
      }
      history.previous = gain;
    }
    written = end;
  };
  let commandIndex = 0;
  for (let start = 0; written < length; start += frameSize) {
    // Commands arrive before the packet completes this normalization frame,
    // including any samples buffered from the previous packet.
    while (start < length && commandIndex < commands.length && commands[commandIndex]!.sample < Math.min(length, start + frameSize)) {
      const command = commands[commandIndex++]!;
      if (command.action !== "p" && command.action !== "peak") continue;
      try {
        const value = parseFilterExpression(command.expression, "dynaudnorm", { min: 0, max: 1, default: 0.95 });
        if (value >= 0 && value <= 1) peak = value;
      } catch { /* Native asendcmd keeps the previous peak after a rejected command. */ }
    }
    // At EOF extend the pending gain history, then feed peak-level padding
    // through the same sliding window while draining the remaining audio.
    const padding = start >= length;
    if (padding) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
      while (!histories[0]!.smoothed.length) {
        for (const history of histories) append(history, history.original[0]!);
      }
    }
    if (histories[0]!.smoothed.length) await amplify();
    const paddingLevel = targetRms > Number.EPSILON ? Math.min(peak, targetRms) : peak;
    magnitudes.fill(padding ? Math.max(Number.EPSILON, paddingLevel) : Number.EPSILON);
    const end = Math.min(length, start + frameSize);
    const windowStart = Math.max(0, start + frameSize - windowSize);
    const paddingSamples = padding ? Math.min(windowSize, start + frameSize - Math.ceil(length / frameSize) * frameSize) : 0;
    squares.fill(paddingSamples * paddingLevel * paddingLevel * (coupling ? channels.length : 1));
    for (const [c, channel] of channels.entries()) {
      const h = coupling ? 0 : c;
      for (let i = windowStart; i < end; i++) {
        if (++work % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        magnitudes[h] = Math.max(magnitudes[h]!, Math.abs(channel[i]!));
        if (targetRms > Number.EPSILON) squares[h]! += channel[i]! * channel[i]!;
      }
    }
    // FFmpeg's overlapping analysis buffer includes a second, silent window.
    const samples = frameSize === windowSize ? (padding ? frameSize : end - start) : 2 * windowSize;
    for (const [h, history] of histories.entries()) {
      const rmsGain = targetRms > Number.EPSILON
        ? targetRms / Math.max(Number.EPSILON, Math.sqrt(squares[h]! / (samples * (coupling ? channels.length : 1))))
        : Infinity;
      append(history, bound(Math.min(peak / magnitudes[h]!, rmsGain)));
    }
  }
  return { channels: output, frameSize };
}

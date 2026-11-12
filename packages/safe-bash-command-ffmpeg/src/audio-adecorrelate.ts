import { md5 } from "@noble/hashes/legacy.js";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { validateWeaveGenericOption } from "./weave-generic-option.js";
import { audioExp2, audioTan } from "./audio-gate-math.js";
import { parseFilterExpression } from "./filter-expression.js";

export async function decorrelateAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number }[],
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { stages: 6, seed: -1 };
  let enable: string | undefined;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const entries = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) entries.pop();
  let optionPosition = 0;
  for (const option of entries) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["stages", "seed"][optionPosition] : option.slice(0, separator).trim();
    // FFmpeg restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    optionPosition = separator < 0 ? optionPosition + 1 : optionPosition === 0 ? 1 : 0;
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, option.slice(separator + 1).trim(), "adecorrelate");
      continue;
    }
    if (key === "enable") {
      enable = option.slice(separator + 1).trim();
      parseFilterExpression(enable, "adecorrelate enable", { n: 0, t: 0 }, undefined, new Float64Array(10), []);
      continue;
    }
    if (key !== "stages" && key !== "seed") throw new Error(`adecorrelate: unsupported option ${key}: Option not found`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const min = key === "stages" ? 1 : -1;
    const max = key === "stages" ? 16 : 0xffffffff;
    const number = parseFilterExpression(value, "adecorrelate", {
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2,
      min, max, default: key === "stages" ? 6 : -1, none: 0, all: -1
    }, undefined, new Float64Array(10));
    if (number < min || number > max) {
      throw new RangeError(`adecorrelate: invalid ${key}: value ${value} out of range [${min} - ${max}]`);
    }
    // Integer AVOptions validate before rounding to nearest, with ties to even.
    const rounded = Math.round(number);
    options[key] = number === rounded - 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
  }
  // Evaluate once for all channels and stages, retaining expression state across frames.
  budget.allocateMemory(frames.length + 80);
  const enabled = new Uint8Array(frames.length);
  const registers = new Float64Array(10);
  const randomStates: BigUint64Array[] = [];
  for (const [n, frame] of frames.entries()) {
    if (n % 1024 === 0) {
      budget.checkCpu();
      await yieldTurn(signal);
      signal?.throwIfAborted();
    }
    if (enable === undefined) enabled[n] = 1;
    else {
      const variables = { n, t: frame.pts / sampleRate };
      // Generic timelines evaluate on consumption and again before filter_frame.
      parseFilterExpression(enable, "adecorrelate enable", variables, undefined, registers, randomStates);
      enabled[n] = Number(Math.abs(parseFilterExpression(enable, "adecorrelate enable", variables, undefined, registers, randomStates)) >= 0.5);
    }
  }
  const seed = options.seed === -1 ? Math.floor(Math.random() * 0x100000000) : options.seed;
  // FFmpeg's additive lagged Fibonacci generator uses MD5 to expand the seed.
  budget.allocateMemory(64 * 4 + 16);
  const state = new Uint32Array(64);
  let digest: Uint8Array = new Uint8Array(16);
  for (let i = 8; i < 64; i += 4) {
    new DataView(digest.buffer, digest.byteOffset, 16).setUint32(0, seed, true);
    digest[4] = i;
    digest = md5(digest);
    const view = new DataView(digest.buffer, digest.byteOffset, 16);
    for (let j = 0; j < 4; j++) state[i + j] = view.getUint32(j * 4, true);
  }
  let randomIndex = 0;
  let work = 0;
  const output: Float64Array[] = [];
  for (const channel of channels) {
    budget.allocateMemory(channel.length * 8);
    const samples = Float64Array.from(channel);
    for (let stage = 0; stage < options.stages; stage++) {
      const random = (state[(randomIndex - 24) & 63]! + state[(randomIndex - 55) & 63]!) >>> 0;
      state[randomIndex++ & 63] = random;
      const delay = Math.round((random / 0xffffffff * 2.2917e-3 + 0.83333e-3) * sampleRate);
      const length = delay + 1;
      budget.allocateMemory(length * 16);
      const inputHistory = new Float64Array(length);
      const outputHistory = new Float64Array(length);
      const lowGain = -60 / (0.1 * sampleRate) * delay;
      const highGain = -60 / (0.008 * sampleRate) * delay;
      const t = audioTan(Math.PI * 1100 / sampleRate);
      // Match FFmpeg's ff_exp10 coefficient calculation before filtering doubles.
      const high = audioExp2(Math.log2(10) * (highGain / 20));
      const ratio = audioExp2(Math.log2(10) * ((lowGain - highGain) / 20));
      const root = Math.sqrt(ratio);
      const a1 = (t - root) / (t + root);
      const b0 = (ratio * t - root) / (t + root) * high;
      const b1 = (ratio * t + root) / (t + root) * high;
      let position = 0;
      for (const [n, frame] of frames.entries()) {
        // Bypassed frames keep their input and freeze every stage's delay history.
        if (!enabled[n]) continue;
        for (let i = frame.start; i < frame.end; i++) {
          if (++work % 1024 === 0) {
            budget.checkCpu();
            await yieldTurn(signal);
            signal?.throwIfAborted();
          }
          const previous = (position || length) - 1;
          const next = (position + 1) % length;
          const x = samples[i]!;
          const y = b1 * x + b0 * inputHistory[previous]! + a1 * inputHistory[next]! + inputHistory[position]!
            - a1 * outputHistory[previous]! - b0 * outputHistory[next]! - b1 * outputHistory[position]!;
          inputHistory[position] = x;
          outputHistory[position] = y;
          samples[i] = y;
          position = next;
        }
      }
    }
    output.push(samples);
  }
  return output;
}

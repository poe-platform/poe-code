import { md5 } from "@noble/hashes/legacy.js";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { validateWeaveGenericOption } from "./weave-generic-option.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function decorrelateAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { stages: 6, seed: -1 };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const entries = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) entries.pop();
  for (const [index, option] of entries.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["stages", "seed"][index] : option.slice(0, separator).trim();
    if (key === "threads") {
      validateWeaveGenericOption(key, option.slice(separator + 1).trim(), "adecorrelate");
      continue;
    }
    if (key === "threads") {
      validateWeaveGenericOption(key, option.slice(separator + 1).trim(), "adecorrelate");
      continue;
    }
    if (key !== "stages" && key !== "seed") throw new Error(`adecorrelate: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = Number(value);
    if (!value || !Number.isInteger(number) || number < (key === "stages" ? 1 : -1) || number > (key === "stages" ? 16 : 0xffffffff)) {
      throw new Error(`adecorrelate: invalid ${key}`);
    }
    options[key] = number;
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
      const t = Math.tan(Math.PI * 1100 / sampleRate);
      const high = 10 ** (highGain / 20);
      const ratio = 10 ** ((lowGain - highGain) / 20);
      const root = Math.sqrt(ratio);
      const a1 = (t - root) / (t + root);
      const b0 = (ratio * t - root) / (t + root) * high;
      const b1 = (ratio * t + root) / (t + root) * high;
      let position = 0;
      for (let i = 0; i < samples.length; i++) {
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
    output.push(samples);
  }
  return output;
}

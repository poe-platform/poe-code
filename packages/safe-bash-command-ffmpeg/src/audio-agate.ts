import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export class AgateError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
  }
}

export async function applyAudioGate(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[], budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const name = "agate";
  const options: Record<string, string> = {
    level_in: "1", mode: "downward", range: "0.06125", threshold: "0.125", ratio: "2",
    attack: "20", release: "250", makeup: "1", knee: "2.828427125", detection: "rms", link: "average", level_sc: "1"
  };
  let enable: string | undefined;
  const names = Object.keys(options);
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim();
    if (key === "enable") {
      enable = option.slice(separator + 1).trim();
      parseFilterExpression(enable, "agate enable", { n: 0, t: 0, pos: NaN });
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new AgateError(`${name}: unsupported option ${key}`, 8);
    options[key] = (separator < 0 ? option : option.slice(separator + 1)).trim();
  }
  const number = (key: string, min: number, max: number): number => {
    const value = Number(options[key]);
    if (!options[key] || !Number.isFinite(value)) throw new AgateError(`${name}: invalid ${key}`, 234);
    if (value < min || value > max) throw new AgateError(`${name}: invalid ${key}`, 222);
    return value;
  };
  const choice = (key: string, values: readonly string[]): number => {
    const value = options[key]!;
    const index = values.indexOf(value);
    if (index >= 0) return index;
    if (value === "0" || value === "1") return Number(value);
    throw new AgateError(`${name}: invalid ${key}`, value && Number.isFinite(Number(value)) ? 222 : 234);
  };
  const level = number("level_in", 0.015625, 64);
  const upward = choice("mode", ["downward", "upward"]) === 1;
  const rms = choice("detection", ["peak", "rms"]) === 1;
  const threshold = Math.log(number("threshold", 0, 1)) * (rms ? 2 : 1);
  const range = number("range", 0, 1);
  const expansion = number("ratio", 1, 9000) - 1;
  const attack = Math.min(1, 4000 / (number("attack", 0.01, 9000) * sampleRate));
  const release = Math.min(1, 4000 / (number("release", 0.01, 9000) * sampleRate));
  const makeup = number("makeup", 1, 64);
  const width = Math.log(number("knee", 1, 8));
  const maximum = choice("link", ["average", "maximum"]) === 1;
  // Like native agate, the detector uses level_in; level_sc is only validated.
  number("level_sc", 0.015625, 64);
  const length = channels[0]?.length ?? 0;
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  let envelope = 0;
  for (const [n, frame] of frames.entries()) {
    const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "agate enable", {
      n, t: frame.pts / sampleRate, pos: frame.pos ?? NaN
    })) >= 0.5;
    for (let i = frame.start; i < frame.end; i++) {
      if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      if (!enabled) {
        for (let c = 0; c < channels.length; c++) output[c]![i] = channels[c]![i]!;
        continue;
      }
      let detected = 0;
      for (const channel of channels) {
        const value = Math.abs(channel[i]! * level);
        detected = maximum ? Math.max(detected, value) : detected + value;
      }
      if (!maximum) detected /= channels.length;
      if (rms) detected *= detected;
      envelope += (detected - envelope) * (detected > envelope ? attack : release);
      let gain = 1;
      if (envelope > 0) {
        // RMS gating works in squared amplitude, including its threshold and knee.
        const distance = (Math.log(envelope) - threshold) * (upward ? 1 : -1);
        const expanded = distance >= width / 2 ? distance
          : distance > -width / 2 ? (distance + width / 2) ** 2 / (2 * width) : 0;
        gain = Math.max(range, Math.exp((upward ? 1 : -1) * expansion * expanded));
      }
      const scale = level * gain * makeup;
      for (let c = 0; c < channels.length; c++) output[c]![i] = channels[c]![i]! * scale;
    }
  }
  return output;
}

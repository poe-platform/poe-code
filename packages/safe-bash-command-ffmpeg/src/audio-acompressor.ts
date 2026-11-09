import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function compressAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal,
  sidechain?: readonly (Float32Array | Float64Array)[]
): Promise<Float64Array[]> {
  const name = sidechain ? "sidechaincompress" : "acompressor";
  const options: Record<string, string> = {
    level_in: "1", mode: "downward", threshold: "0.125", ratio: "2", attack: "20", release: "250",
    makeup: "1", knee: "2.82843", link: "average", detection: "rms", level_sc: "1", mix: "1"
  };
  const names = Object.keys(options);
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim();
    if (!key || !Object.hasOwn(options, key)) throw new Error(`${name}: unsupported option ${key}`);
    options[key] = (separator < 0 ? option : option.slice(separator + 1)).trim();
  }
  const number = (key: string, min: number, max: number): number => {
    const value = parseFilterExpression(options[key]!, name, {});
    if (!options[key] || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name}: invalid ${key}`);
    return value;
  };
  const choice = (key: string, values: readonly string[]): number => {
    const value = options[key]!;
    const index = values.indexOf(value);
    if (index >= 0) return index;
    if (value === "0" || value === "1") return Number(value);
    throw new Error(`${name}: invalid ${key}`);
  };
  const level = number("level_in", 0.015625, 64);
  const upward = choice("mode", ["downward", "upward"]) === 1;
  const threshold = Math.log(number("threshold", 0.000976563, 1));
  const reduction = 1 - 1 / number("ratio", 1, 20);
  const attack = Math.min(1, 4000 / (number("attack", 0.01, 2000) * sampleRate));
  const release = Math.min(1, 4000 / (number("release", 0.01, 9000) * sampleRate));
  const makeup = number("makeup", 1, 64);
  const width = Math.log(number("knee", 1, 8));
  const maximum = choice("link", ["average", "maximum"]) === 1;
  const rms = choice("detection", ["peak", "rms"]) === 1;
  // FFmpeg exposes level_sc on acompressor but uses level_in for its detector.
  const sidechainLevel = number("level_sc", 0.015625, 64);
  const detector = sidechain ?? channels;
  const detectorLevel = sidechain ? sidechainLevel : level;
  const mix = number("mix", 0, 1);
  const length = Math.min(channels[0]?.length ?? 0, detector[0]?.length ?? 0);
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  let envelope = 0;
  for (let i = 0; i < length; i++) {
    if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    let detected = 0;
    for (const channel of detector) {
      const value = Math.abs(channel[i]! * detectorLevel);
      detected = maximum ? Math.max(detected, value) : detected + value;
    }
    if (!maximum) detected /= detector.length;
    if (rms) detected *= detected;
    envelope += (detected - envelope) * (detected > envelope ? attack : release);
    let gain = 1;
    if (envelope > 0) {
      const distance = (Math.log(envelope) * (rms ? 0.5 : 1) - threshold) * (upward ? -1 : 1);
      // The symmetric soft knee is a quadratic in logarithmic amplitude.
      const compressed = distance >= width / 2 ? distance
        : distance > -width / 2 ? (distance + width / 2) ** 2 / (2 * width) : 0;
      gain = Math.exp((upward ? 1 : -1) * reduction * compressed);
    }
    const scale = level * (gain * makeup * mix + 1 - mix);
    for (let c = 0; c < channels.length; c++) output[c]![i] = channels[c]![i]! * scale;
  }
  return output;
}

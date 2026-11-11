import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function compressAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal,
  sidechain?: readonly (Float32Array | Float64Array)[],
  commands: readonly { sample: number; expression: string }[] = []
): Promise<Float64Array[]> {
  const name = sidechain ? "sidechaincompress" : "acompressor";
  const options: Record<string, string | number> = {
    level_in: "1", mode: "downward", threshold: "0.125", ratio: "2", attack: "20", release: "250",
    makeup: "1", knee: "2.82843", link: "average", detection: "rms", level_sc: "1", mix: "1"
  };
  const ranges: Record<string, readonly [number, number]> = {
    level_in: [0.015625, 64], threshold: [0.000976563, 1], ratio: [1, 20],
    attack: [0.01, 2000], release: [0.01, 9000], makeup: [1, 64], knee: [1, 8],
    level_sc: [0.015625, 64], mix: [0, 1]
  };
  const choices: Record<string, readonly string[]> = {
    mode: ["downward", "upward"], link: ["average", "maximum"], detection: ["peak", "rms"]
  };
  const names = Object.keys(options);
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const [index, option] of parts.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim();
    if (!key || !Object.hasOwn(options, key)) throw new Error(`${name}: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const range = ranges[key];
    if (range) {
      const numeric = parseFilterExpression(value, name, {});
      if (!value || !Number.isFinite(numeric) || numeric < range[0] || numeric > range[1]) {
        throw new Error(`${name}: invalid ${key}`);
      }
      options[key] = numeric;
    } else {
      const values = choices[key]!;
      const choice = value === "0" || value === "1" ? values[Number(value)]! : value;
      if (!values.includes(choice)) throw new Error(`${name}: invalid ${key}`);
      options[key] = choice;
    }
  }
  const level = Number(options.level_in);
  const upward = options.mode === "upward";
  const threshold = Math.log(Number(options.threshold));
  const reduction = 1 - 1 / Number(options.ratio);
  const attack = Math.min(1, 4000 / (Number(options.attack) * sampleRate));
  const release = Math.min(1, 4000 / (Number(options.release) * sampleRate));
  let makeup = Number(options.makeup);
  const width = Math.log(Number(options.knee));
  const maximum = options.link === "maximum";
  const rms = options.detection === "rms";
  // FFmpeg exposes level_sc on acompressor but uses level_in for its detector.
  const sidechainLevel = Number(options.level_sc);
  const detector = sidechain ?? channels;
  const detectorLevel = sidechain ? sidechainLevel : level;
  const mix = Number(options.mix);
  const length = Math.min(channels[0]?.length ?? 0, detector[0]?.length ?? 0);
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  let envelope = 0;
  let nextCommand = 0;
  for (let i = 0; i < length; i++) {
    if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= i) {
      const command = commands[nextCommand++]!;
      try {
        const value = parseFilterExpression(command.expression, name, {});
        if (Number.isFinite(value) && value >= 1 && value <= 64) makeup = value;
      } catch { /* Native asendcmd continues after a rejected command. */ }
    }
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

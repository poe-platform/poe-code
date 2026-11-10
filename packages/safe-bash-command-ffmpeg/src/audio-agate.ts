import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { gateExp, gateLog } from "./audio-gate-math.js";
import { parseFilterExpression } from "./filter-expression.js";

export class AgateError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
  }
}

export async function applyAudioGate(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[], budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; expression: string }[] = []
): Promise<Float64Array[]> {
  const name = "agate";
  const defaults: Record<string, string> = {
    level_in: "1", mode: "downward", range: "0.06125", threshold: "0.125", ratio: "2",
    attack: "20", release: "250", makeup: "1", knee: "2.828427125", detection: "rms", link: "average", level_sc: "1"
  };
  let enable: string | undefined;
  const options = { ...defaults };
  const names = Object.keys(options);
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let optionPosition = 0;
  const entries = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) entries.pop();
  for (const option of entries) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[optionPosition] : option.slice(0, separator).trim();
    // FFmpeg 7 restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    if (separator < 0) optionPosition++;
    else optionPosition = optionPosition === 0 ? 1 : 0;
    if (key === "enable") {
      enable = option.slice(separator + 1).trim();
      parseFilterExpression(enable, "agate enable", { n: 0, t: 0, pos: NaN });
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new AgateError(`${name}: unsupported option ${key}`, 8);
    options[key] = (separator < 0 ? option : option.slice(separator + 1)).trim();
  }
  const number = (key: string, min: number, max: number): number => {
    let value: number;
    try {
      value = parseFilterExpression(options[key]!, name, {
        E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2,
        min, max, default: Number(defaults[key]), none: 0, all: -1
      }, undefined, new Float64Array(10));
    } catch {
      throw new AgateError(`${name}: invalid ${key}`, 234);
    }
    if (!options[key] || !Number.isFinite(value)) throw new AgateError(`${name}: invalid ${key}`, 234);
    if (value < min || value > max) throw new AgateError(`${name}: invalid ${key}`, 222);
    return value;
  };
  const choice = (key: string, values: readonly string[]): number => {
    let value: number;
    try {
      value = parseFilterExpression(options[key]!, name, Object.fromEntries(values.map((value, index) => [value, index])));
    } catch {
      throw new AgateError(`${name}: invalid ${key}`, 234);
    }
    if (value < 0 || value > values.length - 1) throw new AgateError(`${name}: invalid ${key}`, 222);
    // Native integer options validate the unrounded value, then round ties to even.
    return value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);
  };
  const level = number("level_in", 0.015625, 64);
  const upward = choice("mode", ["downward", "upward"]) === 1;
  const rms = choice("detection", ["peak", "rms"]) === 1;
  const thresholdValue = number("threshold", 0, 1);
  const range = number("range", 0, 1);
  const ratio = number("ratio", 1, 9000);
  const attack = Math.min(1, 1 / (number("attack", 0.01, 9000) * sampleRate / 4000));
  const release = Math.min(1, 1 / (number("release", 0.01, 9000) * sampleRate / 4000));
  let makeup = number("makeup", 1, 64);
  const knee = number("knee", 1, 8);
  const linearThreshold = rms ? thresholdValue * thresholdValue : thresholdValue;
  const linearKneeStart = linearThreshold / Math.sqrt(knee);
  const linearKneeStop = linearThreshold * Math.sqrt(knee);
  const threshold = gateLog(linearThreshold);
  const kneeStart = gateLog(linearKneeStart);
  const kneeStop = gateLog(linearKneeStop);
  const maximum = choice("link", ["average", "maximum"]) === 1;
  // Like native agate, the detector uses level_in; level_sc is only validated.
  number("level_sc", 0.015625, 64);
  const length = channels[0]?.length ?? 0;
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  let envelope = 0;
  let nextCommand = 0;
  for (const [n, frame] of frames.entries()) {
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame.start) {
      const command = commands[nextCommand++]!;
      try {
        const value = parseFilterExpression(command.expression, name, {});
        if (Number.isFinite(value) && value >= 1 && value <= 64) makeup = value;
      } catch { /* Native asendcmd continues after a rejected command. */ }
    }
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
      if (envelope > 0 && (upward ? envelope > linearKneeStart : envelope < linearKneeStop)) {
        const slope = gateLog(envelope);
        // Preserve Infinity + -Infinity at zero threshold, as in native agate.
        let outputLevel = (slope - threshold) * ratio + threshold;
        // Keep FFmpeg's Hermite evaluation order: simplifying the curve changes
        // the low bits that decide integer and float32 rounding boundaries.
        if (knee > 1 && (upward ? slope < kneeStop : slope > kneeStart)) {
          const start = upward ? kneeStop : kneeStart;
          const stop = upward ? kneeStart : kneeStop;
          const width = stop - start;
          const t = (slope - start) / width;
          const t2 = t * t;
          const t3 = t2 * t;
          const p0 = (start - threshold) * ratio + threshold;
          const m0 = ratio * width;
          const ct2 = -3 * p0 - 2 * m0 + 3 * stop - width;
          const ct3 = 2 * p0 + m0 - 2 * stop + width;
          outputLevel = ct3 * t3 + ct2 * t2 + m0 * t + p0;
        }
        gain = Math.max(range, gateExp(outputLevel - slope));
      }
      const scale = level * gain * makeup;
      for (let c = 0; c < channels.length; c++) output[c]![i] = channels[c]![i]! * scale;
    }
  }
  return output;
}

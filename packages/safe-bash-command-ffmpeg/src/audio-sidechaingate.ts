import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function gateAudio(
  first: MediaTrack, filter: string, budget: MediaBudgetTracker, sidechain: readonly (Float32Array | Float64Array)[], signal?: AbortSignal
): Promise<Float64Array[]> {
  const { channelData: channels, sampleRate } = first.decodedAudio!;
  const options: Record<string, string> = {
    level_in: "1", mode: "downward", range: "0.06125", threshold: "0.125", ratio: "2",
    attack: "20", release: "250", makeup: "1", knee: "2.828427125", detection: "rms", link: "average", level_sc: "1"
  };
  const names = Object.keys(options);
  let enable: string | undefined;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim();
    if (key === "enable") {
      enable = option.slice(separator + 1).trim();
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new Error(`sidechaingate: unsupported option ${key}`);
    options[key] = (separator < 0 ? option : option.slice(separator + 1)).trim();
  }
  const number = (key: string, min: number, max: number): number => {
    const value = parseFilterExpression(options[key]!, "sidechaingate", {});
    if (!options[key] || !Number.isFinite(value) || value < min || value > max) throw new Error(`sidechaingate: invalid ${key}`);
    return value;
  };
  const choice = (key: string, values: readonly string[]): number => {
    const value = options[key]!;
    const index = values.indexOf(value);
    if (index >= 0) return index;
    if (value === "0" || value === "1") return Number(value);
    throw new Error(`sidechaingate: invalid ${key}`);
  };
  const level = number("level_in", 0.015625, 64);
  const upward = choice("mode", ["downward", "upward"]) === 1;
  const thresholdValue = number("threshold", 0, 1);
  const range = number("range", 0, 1);
  const ratio = number("ratio", 1, 9000);
  const attack = Math.min(1, 1 / (number("attack", 0.01, 9000) * sampleRate / 4000));
  const release = Math.min(1, 1 / (number("release", 0.01, 9000) * sampleRate / 4000));
  const makeup = number("makeup", 1, 64);
  const knee = number("knee", 1, 8);
  const maximum = choice("link", ["average", "maximum"]) === 1;
  const rms = choice("detection", ["peak", "rms"]) === 1;
  const linearThreshold = rms ? thresholdValue * thresholdValue : thresholdValue;
  const linearKneeStart = linearThreshold / Math.sqrt(knee);
  const linearKneeStop = linearThreshold * Math.sqrt(knee);
  const threshold = Math.log(linearThreshold);
  const kneeStart = Math.log(linearKneeStart);
  const kneeStop = Math.log(linearKneeStop);
  const detectorLevel = number("level_sc", 0.015625, 64);
  const length = Math.min(channels[0]?.length ?? 0, sidechain[0]?.length ?? 0);
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  let envelope = 0;
  let frame = 0;
  let nextFrame = 0;
  let enabled = true;
  if (enable !== undefined && length === 0) {
    parseFilterExpression(enable, "sidechaingate enable", { t: 0, n: 0, w: 0, h: 0 });
  }
  for (let i = 0; i < length; i++) {
    if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    if (enable !== undefined && i === nextFrame) {
      const packet = first.samples[frame];
      const count = packet ? Math.round(packet.duration * sampleRate / first.timescale)
        - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0) : length - i;
      enabled = Math.abs(parseFilterExpression(enable, "sidechaingate enable", {
        t: packet ? packet.pts / first.timescale + (packet.skipSamples ?? 0) / sampleRate : i / sampleRate,
        n: frame, w: 0, h: 0
      })) >= 0.5;
      nextFrame += Math.max(1, count);
      frame++;
    }
    let detected = 0;
    for (const channel of sidechain) {
      const value = Math.abs(channel[i]! * detectorLevel);
      detected = maximum ? Math.max(detected, value) : detected + value;
    }
    if (!maximum) detected /= sidechain.length;
    if (rms) detected *= detected;
    envelope += (detected - envelope) * (detected > envelope ? attack : release);
    let gain = 1;
    if (envelope > 0 && (upward ? envelope > linearKneeStart : envelope < linearKneeStop)) {
      const slope = Math.log(envelope);
      let outputLevel = (slope - threshold) * ratio + threshold;
      // Preserve native evaluation order: reducing this to a gain polynomial can
      // move a sample across a PCM rounding boundary.
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
      const logGain = outputLevel - slope;
      const exponent = Math.round(logGain / Math.LN2);
      // Reduce with split ln(2) before exponentiation so the final power-of-two
      // scaling is exact, retaining the low bit that decides PCM half samples.
      const reduced = (logGain - exponent * 0.6931471803691238) - exponent * 1.9082149292705877e-10;
      gain = Math.max(range, exponent >= -1022 && exponent <= 1023
        ? Math.exp(reduced) * 2 ** exponent : Math.exp(logGain));
    }
    // Timeline bypass leaves the detector running, but skips all program gain.
    const scale = enabled ? level * gain * makeup : 1;
    for (let c = 0; c < channels.length; c++) output[c]![i] = channels[c]![i]! * scale;
  }
  return output;
}

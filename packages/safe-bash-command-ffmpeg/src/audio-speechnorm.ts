import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function normalizeSpeech(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, frames: readonly { start: number; end: number; pts: number }[],
  filter: string, sampleFormat: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { peak: 0.95, expansion: 2, compression: 2, threshold: 0, raise: 0.001, fall: 0.001 };
  const names = Object.keys(options) as (keyof typeof options)[];
  const aliases: Record<string, keyof typeof options> = { p: "peak", e: "expansion", c: "compression", t: "threshold", r: "raise", f: "fall" };
  let enable: string | undefined;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim();
    if (key === "enable") {
      enable = option.slice(separator + 1).trim();
      continue;
    }
    const name = key && (aliases[key] ?? names.find(name => name === key));
    if (!name) throw new Error(`speechnorm: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = parseFilterExpression(value, "speechnorm", {});
    const factor = name === "expansion" || name === "compression";
    if (!value || !Number.isFinite(number) || number < (factor ? 1 : 0) || number > (factor ? 50 : 1)) {
      throw new Error(`speechnorm: invalid ${name}`);
    }
    options[name] = number;
  }
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  // Native keeps gain state in double precision, but applies it in the negotiated sample format.
  const round = sampleFormat === "dblp" ? (value: number) => value : Math.fround;
  // Native enable evaluation follows the latest frame consumed for lookahead.
  // Track when each output frame has complete periods in every channel.
  if (enable !== undefined) budget.allocateMemory(frames.length * 8);
  const readyFrames = enable === undefined ? undefined : new Uint32Array(frames.length);
  const requiredSamples = enable === undefined ? undefined : new Uint32Array(frames.length);
  if (enable !== undefined && frames.length === 0) parseFilterExpression(enable, "speechnorm enable", { t: 0, n: 0, w: 0, h: 0 });
  const maxPeriod = Math.floor(sampleRate / 10);
  for (const [c, channel] of channels.entries()) {
    let gain = options.expansion;
    let start = 0;
    let peak = Number.MIN_VALUE;
    let frameIndex = 0;
    let outputFrame = 0;
    let assignedFrame = 0;
    // Each analysis period gets one gain. Loud periods cap it immediately;
    // subsequent quiet periods recover by the configured raise amount.
    for (let end = 0; end <= channel.length; end++) {
      if (end % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const frameBoundary = end === frames[frameIndex]?.end;
      if (frameBoundary && frameIndex + 1 < frames.length) frameIndex++;
      const signChange = end > 0 && end < channel.length && (channel[end]! >= 0) !== (channel[end - 1]! >= 0);
      // Native analysis checks the period limit between frames or sign runs,
      // not inside a frame's uninterrupted run of samples with the same sign.
      const periodLimit = end - start > maxPeriod && (frameBoundary || signChange);
      if (end > start && (end === channel.length || periodLimit || signChange && peak >= 1 / 32768)) {
        const limit = Math.min(options.expansion, options.peak / peak);
        gain = Math.min(limit, peak >= options.threshold
          ? gain + options.raise : Math.max(1 / options.compression, gain - options.fall));
        const appliedGain = round(gain);
        for (let i = start; i < end; i++) {
          if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          output[c]![i] = round(round(channel[i]!) * appliedGain);
        }
        if (readyFrames && requiredSamples) {
          // Native availability excludes the first unconsumed period, while
          // retaining the remainder of a period already started by output.
          while (assignedFrame < frames.length && (frames[assignedFrame]!.start <= start || frames[assignedFrame]!.end <= end)) {
            const frame = frames[assignedFrame]!;
            requiredSamples[assignedFrame++] = frame.start > start || frame.end <= start ? 0 : frame.end + end - start;
          }
          while (outputFrame < assignedFrame && (requiredSamples[outputFrame]! <= end || end === channel.length)) {
            readyFrames[outputFrame] = Math.max(readyFrames[outputFrame]!, frameIndex, readyFrames[outputFrame - 1] ?? 0);
            outputFrame++;
          }
        }
        start = end;
        // A frame split carries its peak forward until the next sign change.
        if (signChange) peak = Number.MIN_VALUE;
      }
      if (end < channel.length) peak = Math.max(peak, Math.abs(round(channel[end]!)));
    }
  }
  if (enable !== undefined && readyFrames) {
    for (const [n, frame] of frames.entries()) {
      if (n % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const analyzed = readyFrames[n]!;
      const enabled = Math.abs(parseFilterExpression(enable, "speechnorm enable", {
        t: frames[analyzed]!.pts / sampleRate, n: analyzed, w: 0, h: 0
      })) >= 0.5;
      // Gain and period analysis continue even when the output is bypassed.
      if (!enabled) for (const [c, channel] of channels.entries()) {
        output[c]!.set(channel.subarray(frame.start, frame.end), frame.start);
      }
    }
  }
  return output;
}

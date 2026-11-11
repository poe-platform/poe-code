import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export class AlimiterError extends Error {
  constructor(message: string, readonly stage: "options" | "configuration", readonly exitCode = 234) {
    super(message);
  }
}

export async function limitAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal,
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[] = [{ start: 0, end: channels[0]?.length ?? 0, pts: 0 }],
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<{ channels: Float64Array[]; frames: { start: number; end: number; pts: number; pos?: number | undefined }[] }> {
  const defaults = { level_in: 1, level_out: 1, limit: 1, attack: 5, release: 50, asc: 0, asc_level: 0.5, level: 1, latency: 0 };
  const options = { ...defaults };
  const ranges = { level_in: [0.015625, 64], level_out: [0.015625, 64], limit: [0.0625, 1], attack: [0.1, 80], release: [1, 8000], asc: [0, 1], asc_level: [0, 1], level: [0, 1], latency: [0, 1] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const setOption = (key: keyof typeof options, value: string) => {
    const [min, max] = ranges[key];
    const boolean = key === "asc" || key === "level" || key === "latency";
    const number = !boolean ? parseFilterExpression(value, "alimiter", {
      default: defaults[key], min: min!, max: max!, none: 0, all: -1
    }, undefined, new Float64Array(10))
      : ["1", "true", "yes", "y", "on"].includes(value.toLowerCase()) ? 1
      : ["0", "false", "no", "n", "off"].includes(value.toLowerCase()) ? 0 : NaN;
    if (!value || !Number.isFinite(number)) {
      throw new Error(`alimiter: invalid or unsupported ${key}`);
    }
    if (number < min! || number > max!) {
      throw new AlimiterError(`alimiter: invalid or unsupported ${key}`, "options", 222);
    }
    options[key] = number;
  };
  let enable: string | undefined;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const parts = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) parts.pop();
  try {
    let optionPosition = 0;
    for (const option of parts) {
      const separator = option.indexOf("=");
      const key = separator < 0 ? names[optionPosition] : option.slice(0, separator).trim() as keyof typeof options | "enable" | "threads" | "thread_type" | "extra_hw_frames";
      // FFmpeg 7 restarts shorthand after named options, skipping the first slot
      // when it was just visited. The named key does not select the next slot.
      if (separator < 0) optionPosition++;
      else optionPosition = optionPosition === 0 ? 1 : 0;
      if (key === "enable") {
        enable = option.slice(separator + 1).trim();
        continue;
      }
      if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
        validateWeaveGenericOption(key, option.slice(separator + 1).trim(), "alimiter");
        continue;
      }
      if (!key) throw new Error(`alimiter: unsupported option ${key}`);
      if (!Object.hasOwn(options, key)) throw new AlimiterError(`alimiter: unsupported option ${key}`, "options", 8);
      const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
      setOption(key, value);
    }
  } catch (error) {
    if (error instanceof AlimiterError) throw error;
    throw new AlimiterError((error as Error).message, "options");
  }
  let nextCommand = 0;
  const window = Math.floor(sampleRate * (options.attack / 1000));
  if (window < 1) throw new AlimiterError("alimiter: Attack is too small", "configuration");
  const length = channels[0]?.length ?? 0;
  const delay = options.latency ? window - 1 : 0;
  const queueSize = window * channels.length;
  budget.allocateMemory(length * channels.length * 8 + window * (8 + channels.length * 8) + Math.max(2, queueSize) * 12);
  const output = channels.map(() => new Float64Array(length));
  const buffered = channels.map(() => new Float64Array(window));
  const outputFrames: { start: number; end: number; pts: number; pos?: number | undefined }[] = [];
  const pending: (typeof frames)[number][] = [];
  let pendingIndex = 0;
  let nextInPts: number | undefined;
  let nextOutPts: number | undefined;
  let trim = delay;
  let processed = 0;
  let destination = 0;
  if (enable !== undefined && length === 0) parseFilterExpression(enable, "alimiter enable", { t: 0, n: 0, w: 0, h: 0, pos: NaN });
  const peaks = new Float64Array(window);
  // FFmpeg indexes the peak queue by interleaved sample slots, including its
  // cleared-entry sentinel when a short lookahead wraps the queue.
  const positions = new Int32Array(Math.max(2, queueSize)).fill(-1);
  const slopes = new Float64Array(Math.max(2, queueSize));
  const releaseSamples = sampleRate * options.release / 1000;
  const ascCoefficient = Math.pow(0.5, options.asc_level - 0.5) * -2;
  let ascSum = 0;
  let ascCount = 0;
  let attenuation = 1;
  let slope = 0;
  let head = 0;
  let count = 0;
  let work = 0;
  for (let n = 0, drain = delay; n < frames.length || drain > 0; n++) {
    const input = frames[n] ?? { start: length, end: length + Math.min(1024, drain), pts: nextInPts ?? 0 };
    const flushing = n >= frames.length;
    if (flushing) drain -= input.end - input.start;
    while (!flushing && nextCommand < commands.length && commands[nextCommand]!.sample <= input.start) {
      const command = commands[nextCommand++]!;
      // Failed runtime commands leave the current option and DSP state intact.
      try {
        if (command.action === "enable") {
          parseFilterExpression(command.expression, "alimiter enable", { t: 0, n: 0, w: 0, h: 0, pos: NaN });
          enable = command.expression;
        } else if (command.action === "limit" || command.action === "level_in" || command.action === "level_out" || command.action === "level") {
          setOption(command.action, command.expression);
        }
      } catch { /* Native asendcmd continues after a rejected command. */ }
    }
    const { limit, level_in: inputGain, level_out: outputGain } = options;
    const gain = outputGain * (options.level ? 1 / limit : 1);
    const enabled = flushing || enable === undefined || Math.abs(parseFilterExpression(enable, "alimiter enable", {
      t: input.pts / sampleRate, n, w: 0, h: 0, pos: input.pos === undefined || input.pos < 0 ? NaN : input.pos
    })) >= 0.5;
    const start = destination;
    if (enabled) {
      budget.allocateMemory(8);
      pending.push(input);
    }
    // Bypassed frames leave both the lookahead buffer and gain envelope untouched.
    for (let frame = input.start; frame < input.end; frame++) {
      if (++work % 1024 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      if (!enabled) {
        for (let c = 0; c < channels.length; c++) output[c]![destination] = channels[c]![frame]!;
        destination++;
        continue;
      }
      const slot = processed++ % window;
      let peak = 0;
      for (let c = 0; c < channels.length; c++) {
        const sample = (channels[c]![frame] ?? 0) * inputGain;
        buffered[c]![slot] = sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      peaks[slot] = peak;
      if (options.asc && peak > limit) {
        ascSum += peak;
        ascCount++;
      }
      if (peak > limit) {
        const target = limit / peak;
        const releaseSlope = (1 - target) / releaseSamples;
        const attackSlope = (target - attenuation) / window;
        if (attackSlope < slope) {
          slope = attackSlope;
          head = 0;
          count = 1;
          positions[0] = slot * channels.length;
          positions[1] = -1;
          slopes[0] = releaseSlope;
        } else {
          for (let offset = 0; offset < count; offset++) {
            if (++work % 1024 === 0) {
              await yieldTurn(signal);
              signal?.throwIfAborted();
              budget.checkCpu();
            }
            const entry = (head + offset) % queueSize;
            const position = positions[entry]!;
            const distance = ((queueSize - position + slot * channels.length) % queueSize) / channels.length;
            const previousPeak = position < 0 ? 0 : peaks[position / channels.length]!;
            const nextSlope = (target - limit / previousPeak) / distance;
            if (nextSlope < slopes[entry]!) {
              slopes[entry] = nextSlope;
              count = offset + 2;
              const next = (entry + 1) % queueSize;
              positions[next] = slot * channels.length;
              slopes[next] = releaseSlope;
              positions[(next + 1) % queueSize] = -1;
              break;
            }
          }
        }
      }
      const oldest = (slot + 1) % window;
      if (options.asc && peaks[oldest]! > limit) {
        ascSum -= peaks[oldest]!;
        ascCount--;
      }
      attenuation += slope;
      if (trim > 0) trim--;
      else {
        for (let c = 0; c < channels.length; c++) {
          const sample = buffered[c]![oldest]! * attenuation;
          output[c]![destination] = Math.max(-limit, Math.min(limit, sample)) * gain;
        }
        destination++;
      }
      if (oldest * channels.length === positions[head]) {
        if (options.asc) {
          // ASC continues the current attenuation instead of resetting it to the peak.
          slope = (1 - attenuation) / releaseSamples;
          if (ascCount > 0) {
            const target = limit / (ascCoefficient * ascSum) * ascCount;
            if (target > attenuation) {
              slope = Math.min(slope, Math.max((target - attenuation) / releaseSamples, slope / 10));
            }
          }
          if (count > 1) {
            const next = positions[(head + 1) % queueSize]!;
            const distance = ((queueSize + next - oldest * channels.length) % queueSize) / channels.length;
            const nextPeak = next < 0 ? 0 : peaks[next / channels.length]!;
            const nextSlope = (limit / nextPeak - attenuation) / distance;
            if (nextSlope < slope) slope = nextSlope;
          }
        } else {
          slope = slopes[head]!;
          attenuation = limit / peaks[oldest]!;
        }
        count--;
        positions[head] = -1;
        head = (head + 1) % queueSize;
      }
      if (attenuation > 1) {
        attenuation = 1;
        slope = 0;
        count = 0;
        head = 0;
        positions[0] = -1;
      }
      if (attenuation <= 0) {
        attenuation = 1e-13;
        slope = (1 - attenuation) / releaseSamples;
      }
      if (1 - attenuation < 1e-13) attenuation = 1;
      if (Math.abs(slope) < 1e-14) slope = 0;
    }
    if (destination > start) {
      let pts = input.pts;
      if (enabled) {
        const meta = pending[pendingIndex++]!;
        pts = nextOutPts !== undefined && input.pts !== nextOutPts && meta.pts === nextInPts ? nextOutPts : meta.pts;
        nextInPts = meta.pts + meta.end - meta.start;
        nextOutPts = pts + destination - start;
      }
      budget.allocateMemory(32);
      outputFrames.push({ start, end: destination, pts, pos: input.pos });
    }
  }
  return { channels: output, frames: outputFrames };
}

import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";
import { parseFilterExpression } from "./filter-expression.js";
import { audioFadeCurves as curves } from "./audio-fade-curves.js";

export async function fadeAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number }[] | undefined, startSample: number,
  commands: readonly { sample: number; expression: string }[],
  budget: MediaBudgetTracker, signal?: AbortSignal, sampleFormat = "dbl"
): Promise<Float64Array[]> {
  let type = "in";
  const maxSamples = (1n << 63n) - 1n;
  let startOption = 0n;
  let samplesOption = 44100n;
  let startTime = 0;
  let duration = 0;
  let curve = curves.tri!;
  let silence = 0;
  let unity = 1;
  let enable: string | undefined;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const options: string[] = [];
  let option = "";
  let quoted = false;
  // The filter chain has already removed one quoting/escaping layer.
  for (let i = 0; i < argument.length; i++) {
    const char = argument[i]!;
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === "\\" && i + 1 < argument.length) option += argument[++i]!;
    else if (!quoted && char === ":") {
      options.push(option);
      option = "";
    } else option += char;
  }
  if (argument) options.push(option);
  for (const [index, option] of options.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["type", "start_sample", "nb_samples", "start_time", "duration", "curve", "silence", "unity"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "t" || key === "type") {
      if (!["in", "out", "0", "1"].includes(value)) throw new Error("afade: invalid type");
      type = value === "1" || value === "out" ? "out" : "in";
    } else if (key === "c" || key === "curve") {
      const entry = Object.entries(curves).find(([name], index) => value === name || value === String(index - 1));
      if (!entry) throw new Error("afade: invalid curve");
      curve = entry[1];
    } else if (key === "enable") {
      enable = value;
      parseFilterExpression(enable, "afade enable", { n: 0, t: 0 });
    } else {
      const time = key === "st" || key === "start_time" || key === "d" || key === "duration";
      const number = time
        ? parseHlsDuration(value)
        : parseFilterExpression(value, "afade", { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
      if (!value || !Number.isFinite(number) || number < 0) throw new Error(`afade: invalid ${key}`);
      if (key === "ss" || key === "start_sample" || key === "ns" || key === "nb_samples") {
        // FFmpeg integer options round to nearest, with exact halves going to even.
        const rounded = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
        if (rounded > 2 ** 63) throw new Error(`afade: invalid ${key}`);
        // FFmpeg evaluates options as doubles and saturates the rounded INT64_MAX.
        const integer = rounded === 2 ** 63 ? maxSamples : BigInt(rounded);
        if (key === "ss" || key === "start_sample") startOption = integer;
        else {
          if (number < 1) throw new Error("afade: nb_samples must be positive");
          samplesOption = integer;
        }
      } else if (key === "st" || key === "start_time") startTime = number;
      else if (key === "d" || key === "duration") duration = number;
      else if (key === "silence" || key === "unity") {
        if (number > 1) throw new Error(`afade: invalid ${key}`);
        if (key === "silence") silence = number;
        else unity = number;
      } else throw new Error(`afade: unsupported option ${key}`);
    }
  }
  if (startOption + samplesOption > maxSamples) throw new Error("afade: invalid timing");
  let start = Number(startOption);
  let samples = Number(samplesOption);
  if (startTime > 0) start = Math.round(startTime * sampleRate);
  if (duration > 0) samples = Math.round(duration * sampleRate);
  if (!Number.isInteger(start) || !Number.isInteger(samples) || start > 2 ** 63 || samples > 2 ** 63 || samples < 0) throw new Error("afade: invalid timing");
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(length * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  let frameIndex = 0;
  let commandIndex = 0;
  let enabled = true;
  for (let i = 0; i < length; i++) {
    if (i % 4096 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    while (commandIndex < commands.length && commands[commandIndex]!.sample <= i) {
      const command = commands[commandIndex++]!;
      try {
        const value = parseFilterExpression(command.expression, "afade", { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
        if (Number.isFinite(value) && value >= 0 && value <= 1) unity = value;
      } catch { /* Native asendcmd continues after a rejected command. */ }
    }
    while (frames && frameIndex + 1 < frames.length && frames[frameIndex]!.end <= i) frameIndex++;
    const frame = frames?.[frameIndex];
    if (enable !== undefined && (i === 0 || i === frame?.start)) {
      enabled = Math.abs(parseFilterExpression(enable, "afade enable", {
        n: frameIndex, t: (frame?.pts ?? startSample) / sampleRate
      })) >= 0.5;
    }
    let pts = frame ? frame.pts + i - frame.start : startSample + i;
    // Native AV_NOPTS_VALUE precedes the fade: mute fade-in, preserve fade-out.
    if (Number.isNaN(pts)) pts = -Infinity;
    const progress = Math.max(0, Math.min(1, (pts - start) / samples));
    // A positive duration can round to zero samples; both fades mute the boundary.
    const fraction = samples === 0
      ? (type === "out" ? (pts < start ? 1 : 0) : (pts > start ? 1 : 0))
      : type === "out" ? 1 - progress : progress;
    const gain = enabled ? silence + (unity - silence) * curve(fraction) : 1;
    for (let c = 0; c < channels.length; c++) {
      const sample = channels[c]![i]! * gain;
      // Store at the negotiated precision before the next filter consumes samples.
      output[c]![i] = sampleFormat === "s16" ? Math.trunc(sample * 32768) / 32768
        : sampleFormat === "flt" || sampleFormat === "fltp" ? Math.fround(sample) : sample;
    }
  }
  return output;
}

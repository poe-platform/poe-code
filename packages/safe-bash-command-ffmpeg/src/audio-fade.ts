import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";
import { parseFilterExpression } from "./filter-expression.js";
import { audioFadeCurves as curves } from "./audio-fade-curves.js";

export async function fadeAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[] | undefined, startSample: number,
  commands: readonly { sample: number; action: string; expression: string }[],
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
  if (argument && (option || !argument.endsWith(":"))) options.push(option);
  function applyOption(key: string | undefined, value: string) {
    if (key === "t" || key === "type") {
      const number = parseFilterExpression(value, "afade", { in: 0, out: 1 });
      if (number < 0 || number > 1) throw new Error("afade: invalid type");
      type = number > 0.5 ? "out" : "in";
    } else if (key === "c" || key === "curve") {
      const entries = Object.entries(curves);
      const names = Object.fromEntries(entries.map(([name], index) => [name, index - 1]));
      const number = parseFilterExpression(value, "afade", names);
      if (number < -1 || number > entries.length - 2) throw new Error("afade: invalid curve");
      // FFmpeg integer options round to nearest, with exact halves going to even.
      const floor = Math.floor(number);
      const index = number - floor === 0.5 ? floor + Math.abs(floor % 2) : Math.round(number);
      curve = entries[index + 1]![1];
    } else if (key === "enable") {
      parseFilterExpression(value, "afade enable", { n: 0, t: 0, pos: NaN, w: 0, h: 0 });
      enable = value;
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
  let position = 0;
  for (const option of options) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["type", "start_sample", "nb_samples", "start_time", "duration", "curve", "silence", "unity"][position] : option.slice(0, separator).trim();
    // FFmpeg 7 restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    applyOption(key, value);
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
        applyOption(command.action, command.expression);
        if (command.action === "ns" || command.action === "nb_samples") samples = Number(samplesOption);
        if (command.action === "ss" || command.action === "start_sample") start = Number(startOption);
        if ((command.action === "st" || command.action === "start_time") && startTime > 0) {
          start = Math.round(startTime * sampleRate);
        }
        if ((command.action === "d" || command.action === "duration") && duration > 0) samples = Math.round(duration * sampleRate);
      } catch { /* Native asendcmd continues after a rejected command. */ }
    }
    while (frames && frameIndex + 1 < frames.length && frames[frameIndex]!.end <= i) frameIndex++;
    const frame = frames?.[frameIndex];
    if (enable !== undefined && (i === 0 || i === frame?.start)) {
      enabled = Math.abs(parseFilterExpression(enable, "afade enable", {
        n: frameIndex, t: (frame?.pts ?? startSample) / sampleRate,
        pos: frame?.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN, w: 0, h: 0
      })) >= 0.5;
    }
    let pts = frame ? frame.pts + i - frame.start : startSample + i;
    // Native AV_NOPTS_VALUE precedes the fade: mute fade-in, preserve fade-out.
    if (Number.isNaN(pts)) pts = -Infinity;
    const progress = Math.max(0, Math.min(1, (type === "out" ? start + samples - pts : pts - start) / samples));
    // A positive duration can round to zero samples; both fades mute the boundary.
    const fraction = samples === 0
      ? (type === "out" ? (pts < start ? 1 : 0) : (pts > start ? 1 : 0))
      : progress;
    // Native shortcuts whole frames strictly outside the fade, bypassing the curve.
    const frameStart = pts - (i - (frame?.start ?? 0));
    const before = frameStart + (frame ? frame.end - frame.start : length) < start;
    const after = start + samples < frameStart;
    const gain = !enabled ? 1
      : before ? (type === "in" ? silence : unity)
        : after ? (type === "in" ? unity : silence)
          : silence + (unity - silence) * curve(fraction);
    for (let c = 0; c < channels.length; c++) {
      const sample = channels[c]![i]! * gain;
      // Store at the negotiated precision before the next filter consumes samples.
      output[c]![i] = sampleFormat === "s16" || sampleFormat === "s16p" ? Math.trunc(sample * 32768) / 32768
        : sampleFormat === "s32" || sampleFormat === "s32p" ? Math.trunc(sample * 2147483648) / 2147483648
          : sampleFormat === "flt" || sampleFormat === "fltp" ? Math.fround(sample) : sample;
    }
  }
  return output;
}

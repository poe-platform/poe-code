import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";
import { parseFilterExpression } from "./filter-expression.js";

// FFmpeg's curve enum runs from nofade (-1) through hsin2 (22).
const curves: Record<string, (gain: number) => number> = {
  nofade: () => 1,
  tri: gain => gain,
  qsin: gain => Math.sin(gain * Math.PI / 2),
  esin: gain => 1 - Math.cos(Math.PI / 4 * ((2 * gain - 1) ** 3 + 1)),
  hsin: gain => (1 - Math.cos(gain * Math.PI)) / 2,
  log: gain => Math.max(0, Math.min(1, 1 + 0.2 * Math.log10(gain))),
  ipar: gain => 1 - (1 - gain) * (1 - gain),
  qua: gain => gain * gain,
  cub: gain => gain * gain * gain,
  squ: Math.sqrt,
  cbr: Math.cbrt,
  par: gain => 1 - Math.sqrt(1 - gain),
  exp: gain => Math.exp(-11.512925464970227 * (1 - gain)),
  iqsin: gain => 0.6366197723675814 * Math.asin(gain),
  ihsin: gain => 0.3183098861837907 * Math.acos(1 - 2 * gain),
  dese: gain => gain <= 0.5 ? Math.cbrt(2 * gain) / 2 : 1 - Math.cbrt(2 * (1 - gain)) / 2,
  desi: gain => gain <= 0.5 ? (2 * gain) ** 3 / 2 : 1 - (2 * (1 - gain)) ** 3 / 2,
  losi: gain => {
    const a = 1 / (1 - 0.787) - 1;
    const low = 1 / (1 + Math.exp(a));
    const high = 1 / (1 + Math.exp(-a));
    return (1 / (1 + Math.exp(-(gain - 0.5) * a * 2)) - low) / (high - low);
  },
  sinc: gain => gain >= 1 ? 1 : Math.sin(Math.PI * (1 - gain)) / (Math.PI * (1 - gain)),
  isinc: gain => gain <= 0 ? 0 : 1 - Math.sin(Math.PI * gain) / (Math.PI * gain),
  quat: gain => gain * gain * gain * gain,
  quatr: gain => gain ** 0.25,
  qsin2: gain => Math.sin(gain * Math.PI / 2) ** 2,
  hsin2: gain => ((1 - Math.cos(gain * Math.PI)) / 2) ** 2
};

export async function fadeAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number }[] | undefined, startSample: number,
  budget: MediaBudgetTracker, signal?: AbortSignal, pcm16 = false
): Promise<Float64Array[]> {
  let type = "in";
  let start = 0;
  let samples = 44100;
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
        if (!Number.isSafeInteger(rounded)) throw new Error(`afade: invalid ${key}`);
        if (key === "ss" || key === "start_sample") start = rounded;
        else {
          if (number < 1) throw new Error("afade: nb_samples must be positive");
          samples = rounded;
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
  if (startTime > 0) start = Math.round(startTime * sampleRate);
  if (duration > 0) samples = Math.round(duration * sampleRate);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(samples) || samples < 0) throw new Error("afade: invalid timing");
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(length * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  let frameIndex = 0;
  let enabled = true;
  for (let i = 0; i < length; i++) {
    if (i % 4096 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    while (frames && frameIndex + 1 < frames.length && frames[frameIndex]!.end <= i) frameIndex++;
    const frame = frames?.[frameIndex];
    if (enable !== undefined && (i === 0 || i === frame?.start)) {
      enabled = Math.abs(parseFilterExpression(enable, "afade enable", {
        n: frameIndex, t: (frame?.pts ?? startSample) / sampleRate
      })) >= 0.5;
    }
    const pts = frame ? frame.pts + i - frame.start : startSample + i;
    const progress = Math.max(0, Math.min(1, (pts - start) / samples));
    // A positive duration can round to zero samples; both fades mute the boundary.
    const fraction = samples === 0
      ? (type === "out" ? (pts < start ? 1 : 0) : (pts > start ? 1 : 0))
      : type === "out" ? 1 - progress : progress;
    const gain = enabled ? silence + (unity - silence) * curve(fraction) : 1;
    for (let c = 0; c < channels.length; c++) {
      const sample = channels[c]![i]! * gain;
      // Native integer fades truncate before the next filter consumes the samples.
      output[c]![i] = pcm16 ? Math.trunc(sample * 32768) / 32768 : sample;
    }
  }
  return output;
}

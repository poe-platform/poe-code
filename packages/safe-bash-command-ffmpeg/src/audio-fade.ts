import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

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
  let curve = "tri";
  let silence = 0;
  let unity = 1;
  let enable: string | undefined;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["type", "start_sample", "nb_samples", "start_time", "duration", "curve", "silence", "unity"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "t" || key === "type") {
      if (!["in", "out", "0", "1"].includes(value)) throw new Error("afade: invalid type");
      type = value === "1" || value === "out" ? "out" : "in";
    } else if (key === "c" || key === "curve") {
      if (!["tri", "qua", "0", "6"].includes(value)) throw new Error("afade: supported curves are tri and qua");
      curve = value === "qua" || value === "6" ? "qua" : "tri";
    } else if (key === "enable") {
      enable = value;
      parseFilterExpression(enable, "afade enable", { n: 0, t: 0 });
    } else {
      const time = key === "st" || key === "start_time" || key === "d" || key === "duration";
      const scale = time && value.endsWith("ms") ? 0.001 : time && value.endsWith("us") ? 0.000001 : 1;
      const number = time
        ? Number(value.endsWith("s") ? value.slice(0, scale === 1 ? -1 : -2) : value) * scale
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
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(samples) || samples < 1) throw new Error("afade: invalid timing");
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
    const fraction = type === "out" ? 1 - progress : progress;
    const gain = enabled ? silence + (unity - silence) * (curve === "qua" ? fraction * fraction : fraction) : 1;
    for (let c = 0; c < channels.length; c++) {
      const sample = channels[c]![i]! * gain;
      // Native integer fades truncate before the next filter consumes the samples.
      output[c]![i] = pcm16 ? Math.trunc(sample * 32768) / 32768 : sample;
    }
  }
  return output;
}

import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function fadeAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number }[] | undefined, startSample: number,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  let type = "in";
  let start = 0;
  let samples = 44100;
  let startTime = 0;
  let duration = 0;
  let curve = "tri";
  let silence = 0;
  let unity = 1;
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
    } else {
      const time = key === "st" || key === "start_time" || key === "d" || key === "duration";
      const scale = time && value.endsWith("ms") ? 0.001 : time && value.endsWith("us") ? 0.000001 : 1;
      const number = Number(time && value.endsWith("s") ? value.slice(0, scale === 1 ? -1 : -2) : value) * scale;
      if (!value || !Number.isFinite(number) || number < 0) throw new Error(`afade: invalid ${key}`);
      if (key === "ss" || key === "start_sample" || key === "ns" || key === "nb_samples") {
        if (!Number.isSafeInteger(number)) throw new Error(`afade: invalid ${key}`);
        if (key === "ss" || key === "start_sample") start = number;
        else {
          if (number < 1) throw new Error("afade: nb_samples must be positive");
          samples = number;
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
  for (let i = 0; i < length; i++) {
    if (i % 4096 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    while (frames && frameIndex + 1 < frames.length && frames[frameIndex]!.end <= i) frameIndex++;
    const frame = frames?.[frameIndex];
    const pts = frame ? frame.pts + i - frame.start : startSample + i;
    const progress = Math.max(0, Math.min(1, (pts - start) / samples));
    const fraction = type === "out" ? 1 - progress : progress;
    const gain = silence + (unity - silence) * (curve === "qua" ? fraction * fraction : fraction);
    for (let c = 0; c < channels.length; c++) output[c]![i] = channels[c]![i]! * gain;
  }
  return output;
}

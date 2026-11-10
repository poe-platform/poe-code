import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function removeSilence(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<(Float32Array | Float64Array)[]> {
  const options = {
    start_periods: 0, start_duration: 0, start_threshold: 0, start_mode: "any",
    stop_periods: 0, stop_duration: 0, stop_threshold: 0, stop_mode: "all",
    detection: "rms", window: 0.02
  };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const positional = ["start_periods", "start_duration", "start_threshold", "start_silence", "start_mode",
    "stop_periods", "stop_duration", "stop_threshold", "stop_silence", "stop_mode", "detection", "window", "timestamp"];
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? positional[index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "start_mode" || key === "stop_mode") {
      if (!["any", "all", "0", "1"].includes(value)) throw new Error(`silenceremove: invalid ${key}`);
      options[key] = value === "0" || value === "any" ? "any" : "all";
    } else if (key === "detection") {
      if (!["avg", "rms", "peak", "ptp", "0", "1", "2", "4"].includes(value)) throw new Error("silenceremove: supported detection modes are avg, rms, peak and ptp");
      options.detection = value === "4" ? "ptp" : ["avg", "rms", "peak"][Number(value)] ?? value;
    } else if (key === "timestamp" && (value === "write" || value === "0")) {
      // The audio pipeline emits a contiguous timeline.
    } else if ((key === "start_silence" || key === "stop_silence") && value === "0") {
      // Retaining extra silence is not supported.
    } else if (key === "start_periods" || key === "stop_periods" || key === "start_threshold" ||
      key === "stop_threshold" || key === "start_duration" || key === "stop_duration" || key === "window") {
      const threshold = key.endsWith("threshold");
      const periods = key.endsWith("periods");
      const scale = !threshold && !periods && value.endsWith("ms") ? 0.001
        : !threshold && !periods && value.endsWith("us") ? 0.000001 : 1;
      const number = threshold ? parseFilterExpression(value, "silenceremove", {})
        : Number(!threshold && !periods && value.endsWith("s") ? value.slice(0, scale === 1 ? -1 : -2) : value) * scale;
      const min = key === "stop_periods" ? -9000 : 0;
      const max = periods ? 9000 : key === "window" ? 100 : threshold ? Number.MAX_VALUE : 2147.483647;
      if (!value || !Number.isFinite(number) || number < min || number > max) {
        throw new Error(`silenceremove: invalid ${key}`);
      }
      // Native integer options validate bounds before rounding ties to even.
      const lower = Math.floor(number);
      options[key] = periods
        ? number - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(number)
        : number;
    } else throw new Error(`silenceremove: unsupported option ${key}`);
  }

  let output = [...channels];
  const window = Math.max(1, Math.round(options.window * sampleRate));
  const peakToPeak = options.detection === "ptp";
  const trackPeaks = options.detection === "peak" || peakToPeak;
  for (const phase of ["start", "stop"] as const) {
    const periods = options[`${phase}_periods`];
    if (!periods) continue;
    const length = output[0]?.length ?? 0;
    const duration = Math.round(options[`${phase}_duration`] * sampleRate);
    const threshold = options[`${phase}_threshold`];
    const mode = options[`${phase}_mode`];
    budget.allocateMemory(output.length * (8 + (trackPeaks ? length * 4 : 0)));
    const sums = new Float64Array(output.length);
    // Monotonic queues keep peak detection linear even for long windows.
    const peaks = trackPeaks ? output.map(() => new Uint32Array(length)) : [];
    const fronts = output.map(() => 0);
    const backs = output.map(() => 0);
    let count = 0;
    let found = 0;
    let foundSound = false;
    let written = 0;
    let start = length;
    if (phase === "stop") budget.allocateMemory(length * output.length * 8);
    const trimmed = phase === "stop" ? output.map(() => new Float64Array(length)) : [];
    for (let i = 0; i < length; i++) {
      if (i % 4096 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      let matches = mode === "all";
      for (let c = 0; c < output.length; c++) {
        const channel = output[c]!;
        const value = peakToPeak ? channel[i]! : Math.abs(channel[i]!);
        let level: number;
        if (trackPeaks) {
          const queue = peaks[c]!;
          let front = fronts[c]!;
          let back = backs[c]!;
          // Native peak detection expires by value, including repeated equal peaks.
          const previous = i >= window ? channel[i - window]! : 0;
          if (front < back && (peakToPeak ? channel[queue[front]!]! === previous
            : Math.abs(channel[queue[front]!]!) === Math.abs(previous))) front++;
          while (front < back && (peakToPeak ? channel[queue[back - 1]!]!
            : Math.abs(channel[queue[back - 1]!]!)) <= value) back--;
          queue[back++] = i;
          fronts[c] = front;
          backs[c] = back;
          // Native ptp uses the signed maximum and the current sample.
          level = peakToPeak ? Math.abs(value) + Math.abs(channel[queue[front]!]! - value)
            : Math.abs(channel[queue[front]!]!);
        } else {
          const previous = i >= window ? Math.abs(channel[i - window]!) : 0;
          sums[c] = Math.max(0, sums[c]! + (options.detection === "rms"
            ? value * value - previous * previous : value - previous));
          level = sums[c]! / Math.min(i + 1, window);
          if (options.detection === "rms") level = Math.sqrt(level);
        }
        const match = phase === "start" ? level > threshold : level <= threshold;
        matches = mode === "any" ? matches || match : matches && match;
      }
      if (phase === "start") {
        // FFmpeg counts qualifying samples cumulatively and opens after duration, not at it.
        if (matches) count++;
        if (count > duration) {
          count = 0;
          if (++found >= periods) { start = i; break; }
        }
      } else {
        foundSound ||= !matches;
        if (periods < 0 && !matches) found = 0;
        if (found >= 0 && foundSound) count = matches ? count + 1 : 0;
        if (count > duration) {
          if (++found >= Math.abs(periods)) found = -1;
          count = 0;
        }
        if (found >= 0) {
          for (let c = 0; c < output.length; c++) trimmed[c]![written] = output[c]![i]!;
          written++;
        }
      }
    }
    output = phase === "start" ? output.map(c => c.subarray(start)) : trimmed.map(c => c.subarray(0, written));
  }
  return output;
}

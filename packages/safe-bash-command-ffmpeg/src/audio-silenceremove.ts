import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";
import { parseFilterExpression } from "./filter-expression.js";

export async function removeSilence(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: { start: number; end: number; pts: number }[],
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ channels: (Float32Array | Float64Array)[]; frames: typeof frames }> {
  const options = {
    start_periods: 0, start_duration: 0, start_threshold: 0, start_silence: 0, start_mode: "any",
    stop_periods: 0, stop_duration: 0, stop_threshold: 0, stop_silence: 0, stop_mode: "all",
    detection: "rms", window: 0.02
  };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const positional = ["start_periods", "start_duration", "start_threshold", "start_silence", "start_mode",
    "stop_periods", "stop_duration", "stop_threshold", "stop_silence", "stop_mode", "detection", "window", "timestamp"];
  const tokens: string[] = [];
  let token = "";
  let quoted = false;
  // The filter chain has already removed one quoting/escaping layer.
  for (let i = 0; i < argument.length; i++) {
    const char = argument[i]!;
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === "\\" && i + 1 < argument.length) token += argument[++i]!;
    else if (!quoted && char === ":") {
      tokens.push(token);
      token = "";
    } else token += char;
  }
  if (argument) tokens.push(token);
  for (const [index, option] of tokens.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? positional[index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "start_mode" || key === "stop_mode") {
      if (!["any", "all", "0", "1"].includes(value)) throw new Error(`silenceremove: invalid ${key}`);
      options[key] = value === "0" || value === "any" ? "any" : "all";
    } else if (key === "detection") {
      if (!["avg", "rms", "peak", "median", "ptp", "dev", "0", "1", "2", "3", "4", "5"].includes(value)) throw new Error("silenceremove: supported detection modes are avg, rms, peak, median, ptp and dev");
      options.detection = ["avg", "rms", "peak", "median", "ptp", "dev"][Number(value)] ?? value;
    } else if (key === "timestamp" && (value === "write" || value === "0")) {
      // The audio pipeline emits a contiguous timeline.
    } else if (key === "start_periods" || key === "stop_periods" || key === "start_threshold" ||
      key === "stop_threshold" || key === "start_duration" || key === "stop_duration" ||
      key === "start_silence" || key === "stop_silence" || key === "window") {
      const threshold = key.endsWith("threshold");
      const periods = key.endsWith("periods");
      const number = threshold ? parseFilterExpression(value, "silenceremove", {})
        : periods ? Number(value) : parseHlsDuration(value);
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
  const firstPts = frames[0]?.pts ?? 0;
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
    budget.allocateMemory(output.length * (8 + (options.detection === "dev" ? 8 : 0) + (trackPeaks ? length * 4 : 0)));
    const sums = new Float64Array(output.length);
    const squares = options.detection === "dev" ? new Float64Array(output.length) : undefined;
    // Monotonic queues keep peak detection linear even for long windows.
    const peaks = trackPeaks ? output.map(() => new Uint32Array(length)) : [];
    if (options.detection === "median") budget.allocateMemory(output.length * window * 8);
    const medians = options.detection === "median" ? output.map(() => new Float64Array(window)) : [];
    const fronts = output.map(() => 0);
    const backs = output.map(() => 0);
    let count = 0;
    let found = 0;
    let foundSound = false;
    let stopRemaining = 0;
    let written = 0;
    let start = length;
    if (phase === "stop") budget.allocateMemory(length * output.length * 8);
    const trimmed = phase === "stop" ? output.map(() => new Float64Array(length)) : [];
    budget.allocateMemory(frames.length * 4);
    const counts = new Uint32Array(frames.length);
    let frameIndex = 0;
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
        if (options.detection === "median") {
          // FFmpeg selects the middle of a descending queue, retaining equal
          // values. Expiration compares values, not sample positions.
          const queue = medians[c]!;
          let front = fronts[c]!;
          let back = backs[c]!;
          let empty = front === back && queue[front] === -1;
          const previous = i >= window ? Math.abs(channel[i - window]!) : 0;
          if (!empty && previous === queue[front]) {
            queue[front] = -1;
            if (back !== front) front = (front + window - 1) % window;
            empty = front === back;
          }
          while (!empty && value > queue[back]!) {
            queue[back] = -1;
            if (back === front) { empty = true; break; }
            back = (back + 1) % window;
          }
          if (!empty) back = (back + window - 1) % window;
          queue[back] = value;
          const size = (front - back + window) % window + 1;
          level = queue[(back + Math.floor(size / 2)) % window]!;
          fronts[c] = front;
          backs[c] = back;
        } else if (trackPeaks) {
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
        } else if (squares) {
          const sample = channel[i]!;
          const previous = i >= window ? channel[i - window]! : 0;
          const size = Math.min(i + 1, window);
          sums[c] = sums[c]! + sample - previous;
          squares[c] = Math.max(0, squares[c]! + sample * sample - previous * previous);
          level = Math.sqrt(Math.max(0, squares[c]! - sums[c]! * sums[c]! / size) / size);
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
        const retain = found < 0 && stopRemaining > 0;
        if (retain) stopRemaining--;
        if (found >= 0 && foundSound) count = matches ? count + 1 : 0;
        if (count > duration) {
          if (++found >= Math.abs(periods)) {
            found = -1;
            // Native skips the triggering sample and retains the following samples.
            stopRemaining = Math.round(options.stop_silence * sampleRate);
          }
          count = 0;
        }
        if (found >= 0 || retain) {
          for (let c = 0; c < output.length; c++) trimmed[c]![written] = output[c]![i]!;
          while (frameIndex + 1 < frames.length && i >= frames[frameIndex]!.end) frameIndex++;
          counts[frameIndex]!++;
          written++;
        }
      }
    }
    const retention = Math.round(options.start_silence * sampleRate);
    const retained = Math.min(retention, start + 1);
    if (phase === "start" && retained > 0 && start < length) {
      budget.allocateMemory((length - start + retained) * output.length * 8);
      output = output.map(channel => {
        const result = new Float64Array(length - start + retained);
        // Native flush walks backward from the NEXT queue slot, then emits the
        // triggering sample again. Preserve that order, including an unwritten zero.
        result.set(channel.subarray(start - retained + 2, start + 1));
        result[retained - 1] = start >= retention ? channel[start - retention]! : 0;
        result.set(channel.subarray(start), retained);
        return result;
      });
    } else {
      output = phase === "start" ? output.map(c => c.subarray(start)) : trimmed.map(c => c.subarray(0, written));
    }
    const outputFrames: typeof frames = [];
    let offset = 0;
    for (const [n, frame] of frames.entries()) {
      if (n % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const count = phase === "start" ? Math.max(0, frame.end - Math.max(frame.start, start))
        + (frame.start <= start && start < frame.end ? retained : 0) : counts[n]!;
      if (!count) continue;
      budget.allocateMemory(24);
      outputFrames.push({ start: offset, end: offset + count, pts: firstPts + offset });
      offset += count;
    }
    frames = outputFrames;
  }
  return { channels: output, frames };
}

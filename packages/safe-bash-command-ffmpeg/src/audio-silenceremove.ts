import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";

export async function removeSilence(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: { start: number; end: number; pts: number; exactPts?: bigint | undefined; pos?: number | undefined }[],
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<{ channels: (Float32Array | Float64Array)[]; frames: typeof frames; frameSources: (number | undefined)[] }> {
  let enable: string | undefined;
  const options = {
    start_periods: 0, start_duration: 0, start_threshold: 0, start_silence: 0, start_mode: "any",
    stop_periods: 0, stop_duration: 0, stop_threshold: 0, stop_silence: 0, stop_mode: "all",
    detection: "rms", window: 0.02, timestamp: "write"
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
  if (token || (argument && !argument.endsWith(":"))) tokens.push(token);
  let positionalIndex = 0;
  for (const option of tokens) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? positional[positionalIndex++] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      const number = parseFilterExpression(value, "silenceremove", key === "thread_type"
        ? { slice: 1, none: 0, all: -1, default: 1 }
        : key === "threads" ? { default: 0, min: 0, max: 2147483647 }
        : { default: -1, min: -1, max: 2147483647 });
      if (key === "thread_type"
        ? !Number.isInteger(number) || number < -2147483648 || number > 4294967295
        : !Number.isFinite(number) || number < (key === "extra_hw_frames" ? -1 : 0) || number > 2147483647) {
        throw new RangeError(`silenceremove: invalid ${key}`);
      }
      // Scheduling and hardware-frame options do not change the rendered PCM.
    } else if (key === "enable") {
      enable = value;
      parseFilterExpression(enable, "silenceremove enable", {
        n: 0, t: 0, pos: NaN, w: 0, h: 0, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
      }, undefined, new Float64Array(10), []);
    } else if (key === "start_mode" || key === "stop_mode" || key === "detection" || key === "timestamp") {
      const names = key === "detection" ? ["avg", "rms", "peak", "median", "ptp", "dev"]
        : key === "timestamp" ? ["write", "copy"] : ["any", "all"];
      const number = parseFilterExpression(value, "silenceremove", {
        ...Object.fromEntries(names.map((name, i) => [name, i])),
        min: 0, max: names.length - 1, default: key === "stop_mode" || key === "detection" ? 1 : 0
      });
      if (!Number.isFinite(number) || number < 0 || number > names.length - 1) {
        throw new RangeError(`silenceremove: invalid ${key}`);
      }
      const lower = Math.floor(number);
      options[key] = names[number - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(number)]!;
    } else if (key === "start_periods" || key === "stop_periods" || key === "start_threshold" ||
      key === "stop_threshold" || key === "start_duration" || key === "stop_duration" ||
      key === "start_silence" || key === "stop_silence" || key === "window") {
      const threshold = key.endsWith("threshold");
      const periods = key.endsWith("periods");
      const min = key === "stop_periods" ? -9000 : 0;
      const max = periods ? 9000 : key === "window" ? 100 : threshold ? Number.MAX_VALUE : 2147.483647;
      const number = threshold || periods ? parseFilterExpression(value, "silenceremove", { min, max, default: 0 })
        : parseHlsDuration(value);
      if (!value || Number.isNaN(number)) throw new Error(`silenceremove: invalid ${key}`);
      if (!Number.isFinite(number) || number < min || number > max) {
        throw new RangeError(`silenceremove: invalid ${key}`);
      }
      // Native integer options validate bounds before rounding ties to even.
      const lower = Math.floor(number);
      options[key] = periods
        ? number - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(number)
        : number;
    } else throw new Error(`silenceremove: unsupported option ${key}`);
  }

  let output = [...channels];
  budget.allocateMemory(frames.length * 8);
  let frameSources: (number | undefined)[] = frames.map((_, index) => index);
  budget.allocateMemory(frames.length * 19);
  const startThresholds = new Float64Array(frames.length);
  let startThreshold = options.start_threshold;
  let stopThresholds = new Float64Array(frames.length);
  let stopThreshold = options.stop_threshold;
  let startModes = new Uint8Array(frames.length);
  let stopModes = new Uint8Array(frames.length);
  let nextCommand = 0;
  let enabledFrames = new Uint8Array(frames.length);
  // Validation must not advance the per-filter timeline state.
  const registers = new Float64Array(10);
  const randomStates: BigUint64Array[] = [];
  for (const [n, frame] of frames.entries()) {
    if (n % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame.start) {
      const command = commands[nextCommand++]!;
      try {
        if (command.action === "enable") {
          parseFilterExpression(command.expression, "silenceremove enable", {
            n: 0, t: 0, pos: NaN, w: 0, h: 0, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
          }, undefined, new Float64Array(10), []);
          enable = command.expression;
          registers.fill(0);
          randomStates.length = 0;
        } else if (command.action === "start_mode" || command.action === "stop_mode") {
          const value = parseFilterExpression(command.expression, "silenceremove", {
            any: 0, all: 1, min: 0, max: 1, default: command.action === "stop_mode" ? 1 : 0
          });
          // Native validates before rounding integer options, with ties to even.
          if (Number.isFinite(value) && value >= 0 && value <= 1) options[command.action] = value > 0.5 ? "all" : "any";
        } else if (command.action === "start_threshold" || command.action === "stop_threshold") {
          const value = parseFilterExpression(command.expression, "silenceremove", { min: 0, max: Number.MAX_VALUE, default: 0 });
          if (Number.isFinite(value) && value >= 0) {
            if (command.action === "start_threshold") startThreshold = value;
            else stopThreshold = value;
          }
        }
      } catch { /* Native keeps the previous option when a runtime command is rejected. */ }
    }
    startThresholds[n] = startThreshold;
    stopThresholds[n] = stopThreshold;
    startModes[n] = Number(options.start_mode === "all");
    stopModes[n] = Number(options.stop_mode === "all");
    enabledFrames[n] = Number(enable === undefined || Math.abs(parseFilterExpression(enable, "silenceremove enable", {
      n, t: frame.pts / sampleRate,
      pos: frame.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN, w: 0, h: 0,
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    }, undefined, registers, randomStates)) >= 0.5);
  }
  const firstPts = frames[0]?.pts ?? 0;
  const firstExactPts = frames[0]?.exactPts ?? (Number.isNaN(firstPts) ? -(2n ** 63n) : undefined);
  const window = Math.max(1, Math.round(options.window * sampleRate));
  const peakToPeak = options.detection === "ptp";
  const trackPeaks = options.detection === "peak" || peakToPeak;
  for (const phase of ["start", "stop"] as const) {
    const periods = options[`${phase}_periods`];
    if (!periods) continue;
    const length = output[0]?.length ?? 0;
    const duration = Math.round(options[`${phase}_duration`] * sampleRate);
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
    const retention = phase === "start" ? Math.round(options.start_silence * sampleRate) : 0;
    budget.allocateMemory((length + Math.min(length, retention)) * output.length * 8);
    const trimmed = output.map(() => new Float64Array(length + Math.min(length, retention)));
    budget.allocateMemory(frames.length * 4);
    const counts = new Uint32Array(frames.length);
    let frameIndex = 0;
    let firstForwardedFrame = frames.length;
    for (let i = 0; i < length; i++) {
      if (i % 4096 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      while (frameIndex + 1 < frames.length && i >= frames[frameIndex]!.end) frameIndex++;
      const threshold = phase === "start" ? startThresholds[frameIndex]! : stopThresholds[frameIndex]!;
      const enabled = enabledFrames[frameIndex] !== 0;
      let keep = !enabled;
      const all = (phase === "start" ? startModes : stopModes)[frameIndex] !== 0;
      let matches = all;
      for (let c = 0; c < output.length && !(phase === "start" && found >= periods); c++) {
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
            : Math.abs(channel[queue[front]!]!) === Math.abs(previous))) {
            front++;
            // Native marks the queue empty when expiration brings its ends together.
            if (back - front === 1) front = back;
          }
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
          // Preserve native RMS addition/subtraction order: rounding affects zero thresholds.
          sums[c] = Math.max(0, options.detection === "rms"
            ? sums[c]! + value * value - previous * previous : sums[c]! + (value - previous));
          level = sums[c]! / Math.min(i + 1, window);
          if (options.detection === "rms") level = Math.sqrt(level);
        }
        const match = phase === "start" ? level > threshold : level <= threshold;
        matches = all ? matches && match : matches || match;
      }
      if (phase === "start") {
        // FFmpeg counts qualifying samples cumulatively and opens after duration, not at it.
        if (found < periods && matches) count++;
        if (count > duration) {
          count = 0;
          // Native forwards subsequent frames only after a single start period, without stop removal.
          if (periods === 1 && options.stop_periods === 0) firstForwardedFrame = frameIndex + 1;
          if (++found >= periods && enabled) {
            const retained = Math.min(retention, i + 1);
            if (retained > 0) {
              for (let c = 0; c < output.length; c++) {
                // Native flush includes the next queue slot, then repeats the triggering sample.
                trimmed[c]!.set(output[c]!.subarray(i - retained + 2, i + 1), written);
                trimmed[c]![written + retained - 1] = i >= retention ? output[c]![i - retention]! : 0;
              }
              written += retained;
              counts[frameIndex]! += retained;
            }
          }
        }
        keep ||= found >= periods;
      } else {
        foundSound ||= !matches;
        if (periods < 0 && !matches) found = 0;
        const retain = enabled && found < 0 && stopRemaining > 0;
        if (retain) stopRemaining--;
        // Timeline bypass keeps the detector and period counters running.
        if ((found >= 0 || !enabled) && foundSound) count = matches ? count + 1 : 0;
        if (count > duration) {
          if (++found >= Math.abs(periods)) {
            found = -1;
            // Native skips the triggering sample and retains the following samples.
            stopRemaining = Math.round(options.stop_silence * sampleRate);
          }
          count = 0;
        }
        keep ||= found >= 0 || retain;
      }
      if (keep) {
        for (let c = 0; c < output.length; c++) trimmed[c]![written] = output[c]![i]!;
        counts[frameIndex]!++;
        written++;
      }
    }
    output = trimmed.map(c => c.subarray(0, written));
    const outputFrames: typeof frames = [];
    budget.allocateMemory(frames.length * 8);
    const outputSources: typeof frameSources = [];
    budget.allocateMemory(frames.length * 11);
    const retainedThresholds = new Float64Array(frames.length);
    const retainedEnabled = new Uint8Array(frames.length);
    const retainedStartModes = new Uint8Array(frames.length);
    const retainedStopModes = new Uint8Array(frames.length);
    let offset = 0;
    for (let n = 0; n < frames.length; n++) {
      if (n % 4096 === 0) { await yieldTurn(signal); budget.checkCpu(); }
      const frame = frames[n]!;
      const count = counts[n]!;
      if (!count) continue;
      // Each surviving input frame keeps its PTS, even when its leading samples were removed.
      budget.allocateMemory(frame.exactPts === undefined ? 32 : 56);
      retainedThresholds[outputFrames.length] = stopThresholds[n]!;
      retainedEnabled[outputFrames.length] = enabledFrames[n]!;
      retainedStartModes[outputFrames.length] = startModes[n]!;
      retainedStopModes[outputFrames.length] = stopModes[n]!;
      outputSources.push(n >= firstForwardedFrame ? frameSources[n] : undefined);
      outputFrames.push({ start: offset, end: offset + count, pts: frame.pts, exactPts: frame.exactPts,
        pos: n >= firstForwardedFrame ? frame.pos : undefined });
      offset += count;
    }
    frames = outputFrames;
    frameSources = outputSources;
    enabledFrames = retainedEnabled;
    stopThresholds = retainedThresholds;
    startModes = retainedStartModes;
    stopModes = retainedStopModes;
  }
  if (options.timestamp === "write" && (options.start_periods || options.stop_periods)) {
    for (const [index, frame] of frames.entries()) {
      if (index % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      // Native advances the int64 NOPTS sentinel after the first emitted frame.
      // Keep exact ticks for diagnostics; expressions use their double value.
      if (firstExactPts !== undefined && (index > 0 || !Number.isNaN(firstPts))) {
        if (frame.exactPts === undefined) budget.allocateMemory(24);
        frame.exactPts = firstExactPts + BigInt(frame.start);
        frame.pts = Number(frame.exactPts);
      } else {
        delete frame.exactPts;
        frame.pts = firstPts + frame.start;
      }
    }
  }
  return { channels: output, frames, frameSources };
}

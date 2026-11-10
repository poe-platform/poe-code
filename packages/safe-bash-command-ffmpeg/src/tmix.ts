import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterFloat } from "./filter-float.js";
import { parseFilterExpression } from "./filter-expression.js";

export async function tmix(
  frames: MediaVideoFrame[], argument: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options: Record<string, string> = { frames: "3", weights: "1", scale: "0", planes: "15" };
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["frames", "weights", "scale", "planes"][index] : option.slice(0, separator).trim();
    if (key !== "frames" && key !== "weights" && key !== "enable" && key !== "planes" && key !== "scale") throw new Error(`tmix: unsupported option ${key}`);
    options[key] = (separator < 0 ? option : option.slice(separator + 1)).trim();
  }
  const value = parseFilterExpression(options.frames!, "tmix", {
    PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2, default: 3, min: 1, max: 1024
  });
  if (value < 1 || value > 1024) {
    throw new RangeError("tmix: frames must be from 1 to 1024");
  }
  // Native validates bounds before rounding integer options to nearest, ties to even.
  const lower = Math.floor(value);
  const count = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  const planes = Number(options.planes);
  if (!Number.isInteger(planes) || planes < 0 || planes > 15) {
    throw new Error("tmix: planes must be an integer from 0 to 15");
  }
  const scale = Math.fround(Number(options.scale));
  if (!Number.isFinite(scale) || scale < 0 || scale > 32767) {
    throw new Error("tmix: scale must be a finite number from 0 to 32767");
  }
  const supplied = (options.weights || "1").replaceAll("|", " ").split(" ").filter(Boolean).slice(0, count).map(value => Math.fround(parseFilterFloat(value)));
  if (supplied.some(weight => !Number.isFinite(weight))) {
    throw new Error("tmix: weights must be finite numbers");
  }
  const weights = Array.from({ length: count }, (_, index) => supplied[Math.min(index, supplied.length - 1)]!);
  const sum = weights.reduce((total, weight) => Math.fround(total + weight), 0);
  if (!Number.isFinite(sum)) throw new Error("tmix: weights must have a finite sum");
  const output: MediaVideoFrame[] = [];
  const factor = scale || Math.fround(1 / sum);
  const average = weights.every(weight => weight === weights[0]) && (scale === 0 || scale === Math.fround(1 / sum));
  const registers = new Float64Array(10);
  const randomStates: BigUint64Array[] = [];
  let runningSum: Uint16Array | undefined;
  let work = 0;
  for (const [index, frame] of frames.entries()) {
    if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    // Pad the initial history with the first frame; weights run oldest to newest.
    const history = weights.map((_, slot) => frames[Math.max(0, index - count + 1 + slot)]!);
    if (history.some(previous => previous.width !== frame.width || previous.height !== frame.height)) {
      throw new Error("tmix: frames must have matching dimensions");
    }
    const enabled = options.enable === undefined || Math.abs(parseFilterExpression(options.enable, "tmix enable", {
      n: index, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN,
      NAN: NaN, INF: Infinity, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    }, undefined, registers, randomStates)) >= 0.5;
    if (count === 1 || !enabled) {
      // Native bypass advances history and emits its oldest frame, including its PTS.
      output.push(count === 1 ? frame : history[0]!);
      continue;
    }
    const native = frame.native;
    const useNative = native && [0, 4, 5, 12, 13, 14].includes(native.format) && history.every(previous =>
      previous.native?.rgba === previous.data && previous.native.width === previous.width &&
      previous.native.height === previous.height && previous.native.format === native.format &&
      previous.native.colorspace === native.colorspace && previous.native.fullRange === native.fullRange &&
      previous.native.pixels.length === native.pixels.length);
    const sources = history.map(previous => useNative ? previous.native!.pixels : previous.data);
    budget.allocateMemory(useNative ? native.pixels.length + frame.data.length : frame.data.length);
    const data = new Uint8Array(sources[0]!.length);
    const lumaSize = frame.width * frame.height;
    const chromaSize = useNative ? (native.pixels.length - lumaSize) / 2 : 0;
    if (average && !runningSum) {
      budget.allocateMemory(data.length * 2);
      runningSum = new Uint16Array(data.length);
    }
    for (let offset = 0; offset < data.length; offset++) {
      const plane = useNative && offset >= lumaSize ? (offset < lumaSize + chromaSize ? 1 : 2) : 0;
      if ((planes & (1 << plane)) === 0) {
        // Native tmix copies unselected planes from the oldest history frame.
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        data[offset] = sources[0]![offset]!;
        continue;
      }
      if (average) {
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        // The native uint16 accumulator freezes during bypass, even at startup.
        runningSum![offset]! += sources[count - 1]![offset]! * (index === 0 ? count : 1);
        data[offset] = Math.floor((runningSum![offset]! + (count >> 1)) / count);
        runningSum![offset]! -= sources[Math.max(0, count - index - 1)]![offset]!;
        continue;
      }

      let value = 0;
      for (let slot = 0; slot < count; slot++) {
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        value = Math.fround(value + Math.fround(sources[slot]![offset]! * weights[slot]!));
      }
      value = Math.fround(value * factor);
      // Weighted mixing uses lrintf (ties to even).
      const rounded = value - Math.floor(value) === 0.5
        ? 2 * Math.round(value / 2) : Math.round(value);
      // Native integer mixing converts non-finite results of canceling weights to zero.
      data[offset] = Number.isFinite(rounded) ? Math.max(0, Math.min(255, rounded)) : 0;
    }
    if (useNative) {
      const mixedNative = { ...native, pixels: data };
      const rgba = scaleVideoPicture({ ...frame, native: mixedNative }, frame.width, frame.height)!;
      output.push({ ...frame, data: rgba, native: { ...mixedNative, rgba } });
    } else {
      const mixed = { ...frame, data };
      delete mixed.native;
      output.push(mixed);
    }
  }
  if (runningSum) budget.releaseMemory(runningSum.byteLength);
  return output;
}

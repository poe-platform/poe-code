import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function tmix(
  frames: MediaVideoFrame[], argument: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options: Record<string, string> = { frames: "3", weights: "1" };
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["frames", "weights"][index] : option.slice(0, separator).trim();
    if (key !== "frames" && key !== "weights") throw new Error(`tmix: unsupported option ${key}`);
    options[key] = (separator < 0 ? option : option.slice(separator + 1)).trim();
  }
  const count = Number(options.frames);
  if (!Number.isInteger(count) || count < 1 || count > 1024) {
    throw new Error("tmix: frames must be an integer from 1 to 1024");
  }
  const supplied = options.weights!.split(" ").filter(Boolean).map(Number);
  if (!supplied.length || supplied.some(weight => !Number.isFinite(weight))) {
    throw new Error("tmix: weights must be finite numbers");
  }
  const weights = Array.from({ length: count }, (_, index) => supplied[Math.min(index, supplied.length - 1)]!);
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (!Number.isFinite(sum) || sum === 0) throw new Error("tmix: weights must have a finite nonzero sum");
  const output: MediaVideoFrame[] = [];
  let work = 0;
  for (const [index, frame] of frames.entries()) {
    // Pad the initial history with the first frame; weights run oldest to newest.
    const history = weights.map((_, slot) => frames[Math.max(0, index - count + 1 + slot)]!);
    if (history.some(previous => previous.width !== frame.width || previous.height !== frame.height)) {
      throw new Error("tmix: frames must have matching dimensions");
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
    for (let offset = 0; offset < data.length; offset++) {
      let value = 0;
      for (let slot = 0; slot < count; slot++) {
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        value += sources[slot]![offset]! * weights[slot]!;
      }
      data[offset] = Math.max(0, Math.min(255, Math.round(value / sum)));
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
  return output;
}

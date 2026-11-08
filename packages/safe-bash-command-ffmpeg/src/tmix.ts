import type { MediaVideoFrame, MediaBudgetTracker } from "@poe-code/mp4-ast";
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
    budget.allocateMemory(frame.data.length);
    const data = new Uint8Array(frame.data.length);
    for (let offset = 0; offset < data.length; offset++) {
      let value = 0;
      for (let slot = 0; slot < count; slot++) {
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        value += history[slot]!.data[offset]! * weights[slot]!;
      }
      data[offset] = Math.max(0, Math.min(255, Math.round(value / sum)));
    }
    const mixed = { ...frame, data };
    delete mixed.native;
    output.push(mixed);
  }
  return output;
}

import { type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function atadenoise(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const defaults = { "0a": 0.02, "0b": 0.04, "1a": 0.02, "1b": 0.04, "2a": 0.02, "2b": 0.04, s: 9, p: 7, a: 0 };
  const options = { ...defaults };
  let position = 0;
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? Object.keys(defaults)[position++] : option.slice(0, separator).trim();
    if (!key || !Object.hasOwn(defaults, key)) throw new Error(`atadenoise: unsupported option ${key}`);
    const name = key as keyof typeof defaults;
    const expression = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const min = name === "s" ? 5 : 0;
    const max = name === "s" ? 129 : name === "p" ? 15 : name === "a" ? 1 : name.endsWith("a") ? 0.3 : 5;
    const value = parseFilterExpression(expression, "atadenoise", { min, max, default: defaults[name], ...(name === "a" ? { p: 0, s: 1 } : {}) });
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`atadenoise: ${name} must be between ${min} and ${max}`);
    options[name] = name.length === 2 ? Math.fround(value)
      : value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);
  }
  const size = options.s | 1;
  const radius = size >> 1;
  const thresholdA = Math.trunc(Math.fround(options["0a"] * 256 - 1));
  const thresholdB = Math.trunc(Math.fround(options["0b"] * 256 - 1));
  const output: MediaVideoFrame[] = [];
  const queue: MediaVideoFrame[] = [];
  let available = 0;
  let work = 0;
  // The native queue starts with repeated first frames. On EOF it feeds back
  // queue[available], then decrements available, preserving the final center PTS.
  for (let index = 0; index < frames.length || available > 0; index++) {
    signal?.throwIfAborted();
    budget.checkCpu();
    const flushing = index >= frames.length;
    const incoming = flushing ? queue[available]! : frames[index]!;
    if (!incoming) break;
    if (queue.length < size) {
      if (queue.length < radius) for (let pad = 0; pad < radius; pad++) queue.push(incoming);
      queue.push(incoming);
      available++;
      if (flushing) available--;
      continue;
    }
    const frame = queue[radius]!;
    if (queue.some(item => item.width !== frame.width || item.height !== frame.height)) {
      throw new Error("atadenoise: frames must have matching dimensions");
    }
    if (queue.some(item => item.native?.rgba === item.data ? item.native.format !== 8 : pixelFormat !== "gray" && pixelFormat !== "gray8")) {
      throw new Error("atadenoise: only 8-bit grayscale input is supported");
    }
    if (!(options.p & 1)) {
      output.push(frame);
    } else {
      budget.allocateMemory(frame.data.length);
      const data = new Uint8Array(frame.data);
      for (let offset = 0; offset < data.length; offset += 4) {
        const center = frame.data[offset]!;
        let sum = center;
        let count = 1;
        let leftDiff = 0;
        let rightDiff = 0;
        let leftStopped = false;
        let rightStopped = false;
        for (let distance = 1; distance <= radius; distance++) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          if (!leftStopped) {
            const value = queue[radius - distance]!.data[offset]!;
            const difference = Math.abs(center - value);
            leftDiff += difference;
            leftStopped = difference > thresholdA || leftDiff > thresholdB;
            if (leftStopped && options.a === 0) break;
            if (!leftStopped) { sum += value; count++; }
          }
          if (!rightStopped) {
            const value = queue[radius + distance]!.data[offset]!;
            const difference = Math.abs(center - value);
            rightDiff += difference;
            rightStopped = difference > thresholdA || rightDiff > thresholdB;
            if (rightStopped && options.a === 0) break;
            if (!rightStopped) { sum += value; count++; }
          }
          if (leftStopped && rightStopped) break;
        }
        const value = Math.floor((sum + (count >> 1)) / count);
        data[offset] = data[offset + 1] = data[offset + 2] = value;
      }
      const filtered = { ...frame, data };
      delete filtered.native;
      output.push(filtered);
    }
    queue.shift();
    queue.push(incoming);
    if (flushing) available--;
  }
  return output;
}

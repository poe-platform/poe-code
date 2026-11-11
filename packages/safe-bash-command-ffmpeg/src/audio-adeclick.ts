import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { declickWindow } from "./audio-declick-window.js";

export async function declickAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const declip = filter.split("=", 1)[0] === "adeclip";
  const name = declip ? "adeclip" : "adeclick";
  const defaults = { window: 55, overlap: 75, arorder: declip ? 8 : 2, threshold: declip ? 10 : 2, burst: 2, hsize: 1000, method: 0 };
  const options = { ...defaults };
  const names = (Object.keys(options) as (keyof typeof options)[]).filter(key => key !== (declip ? "burst" : "hsize"));
  const aliases = { w: "window", o: "overlap", a: "arorder", t: "threshold", b: "burst", n: "hsize", m: "method" } as const;
  const ranges = { window: [10, 100], overlap: [50, 95], arorder: [0, 25], threshold: [1, 100], burst: [0, 10], hsize: [100, 9999], method: [0, 1] };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [i, part] of (argument ? argument.split(":") : []).entries()) {
    const separator = part.indexOf("=");
    const option = separator < 0 ? names[i] : part.slice(0, separator).trim();
    const key = (aliases[option as keyof typeof aliases] ?? option) as keyof typeof options;
    if (!names.includes(key)) throw new Error(`${name}: unsupported option ${option}`);
    const raw = (separator < 0 ? part : part.slice(separator + 1)).trim();
    const [min, max] = ranges[key];
    const value = parseFilterExpression(raw, name, {
      min: min!, max: max!, default: defaults[key],
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2,
      ...(key === "method" ? { add: 0, a: 0, save: 1, s: 1 } : {})
    });
    if (!raw || !Number.isFinite(value)) {
      throw new Error(`${name}: invalid ${key}`);
    }
    if (value < min! || value > max!) throw new RangeError(`${name}: invalid ${key}`);
    // Native integer options validate the range before rounding ties to even.
    options[key] = key === "method" || key === "hsize"
      ? (value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value)) : value;
  }
  const size = Math.max(100, Math.trunc(sampleRate * options.window / 1000));
  const order = Math.max(1, Math.trunc(size * options.arorder / 100));
  const hop = Math.max(1, Math.trunc(size * (1 - options.overlap / 100)));
  const skip = options.method ? Math.trunc((size - hop) / 2) : 0;
  const burst = Math.trunc(size * options.burst / 1000);
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(channels.length * length * 8 + size * 40 + (order + 1) * 32 + (declip ? options.hsize * 4 : 0));
  const window = options.method ? undefined : declickWindow(size, hop, budget);
  const histogram = new Uint32Array(declip ? options.hsize : 0);
  const output = channels.map(() => new Float64Array(length));
  const frame = new Float64Array(size), repaired = new Float64Array(size);
  const clicks = new Uint8Array(size), indices = new Int32Array(size);
  const correlation = new Float64Array(order + 1), coefficients = new Float64Array(order + 1);
  const prediction = new Float64Array(order + 1), next = new Float64Array(order + 1);
  let matrixCapacity = 0;
  let matrix = new Float64Array(0), solution = new Float64Array(0);
  for (const [c, channel] of channels.entries()) {
    frame.fill(0);
    for (let start = 0; start < length; start += hop) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      // Native keeps the unfilled tail of its analysis buffer at end of stream.
      for (let i = 0; i < size && start - skip + i < length; i++) frame[i] = channel[start - skip + i] ?? 0;
      for (let lag = 0; lag <= order; lag++) {
        if (lag % 16 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        let sum = 0;
        for (let i = lag; i < size; i++) sum += frame[i]! * frame[i - lag]!;
        correlation[lag] = sum / size;
      }
      prediction.fill(0);
      let variance = correlation[0]!;
      for (let p = 0; p < order; p++) {
        let error = correlation[p + 1]!;
        for (let j = 0; j < p; j++) error += prediction[j]! * correlation[p - j]!;
        const reflection = -error / variance;
        variance *= 1 - reflection * reflection;
        for (let j = 0; j < p; j++) next[j] = prediction[j]! + reflection * prediction[p - j - 1]!;
        next[p] = reflection;
        prediction.set(next.subarray(0, p + 1));
      }
      coefficients[0] = 1;
      coefficients.set(prediction.subarray(0, order), 1);
      repaired.set(frame);
      if (coefficients.every(Number.isFinite)) {
        clicks.fill(0);
        if (declip) {
          histogram.fill(0);
          for (const sample of frame) {
            const bin = Math.trunc(Math.min(Math.abs(sample), 1) * (histogram.length - 1));
            histogram[bin] = histogram[bin]! + 1;
          }
          // A pile-up in the highest occupied amplitude bin identifies clipped peaks.
          for (let bin = histogram.length - 1; bin > 1; bin--) {
            if (!histogram[bin]) continue;
            if (histogram[bin]! / Math.max(histogram[bin - 1]!, 1) > options.threshold) {
              const amplitude = bin / histogram.length;
              for (let i = order; i < size - order; i++) clicks[i] = Number(Math.abs(frame[i]!) >= amplitude);
            }
            break;
          }
        } else {
          let previous = -1;
          for (let i = order; i < size; i++) {
            let residual = 0;
            for (let j = 0; j <= order; j++) residual += coefficients[j]! * frame[i - j]!;
            if (Math.abs(residual) > Math.sqrt(variance) * options.threshold) {
              clicks[i] = 1;
              if (previous >= 0 && i <= previous + burst) clicks.fill(1, previous + 1, i);
              previous = i;
            }
          }
        }
        clicks.fill(0, 0, order); clicks.fill(0, size - order);
        let count = 0;
        for (let i = order; i < size - order; i++) if (clicks[i]) indices[count++] = i;
        if (count) {
          if (count > matrixCapacity) {
            budget.allocateMemory((count * count - matrixCapacity * matrixCapacity + count - matrixCapacity) * 8);
            matrixCapacity = count;
            matrix = new Float64Array(count * count); solution = new Float64Array(count);
          }
          for (let lag = 0; lag <= order; lag++) {
            let sum = 0;
            for (let j = lag; j <= order; j++) sum += coefficients[j]! * coefficients[j - lag]!;
            correlation[lag] = sum;
          }
          for (let i = 0; i < count; i++) {
            for (let j = 0; j <= i; j++) matrix[i * count + j] = correlation[indices[i]! - indices[j]!] ?? 0;
            let sum = 0;
            for (let j = -order; j <= order; j++) {
              const position = indices[i]! - j;
              if (!clicks[position]) sum -= frame[position]! * correlation[Math.abs(j)]!;
            }
            solution[i] = sum;
          }
          // LDL transpose factorization solves the missing samples jointly.
          // The matrix and its factors have bandwidth at most the prediction order.
          for (let i = 0; i < count; i++) {
            await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
            let diagonal = matrix[i * count + i]!;
            for (let k = Math.max(0, i - order); k < i; k++) diagonal -= matrix[k * count + k]! * matrix[i * count + k]! ** 2;
            if (!Number.isFinite(diagonal) || diagonal === 0) throw new Error(`${name}: singular interpolation matrix`);
            matrix[i * count + i] = diagonal;
            for (let j = i + 1; j < Math.min(count, i + order + 1); j++) {
              let value = matrix[j * count + i]!;
              for (let k = Math.max(0, j - order); k < i; k++) value -= matrix[k * count + k]! * matrix[i * count + k]! * matrix[j * count + k]!;
              matrix[j * count + i] = value / diagonal;
            }
            for (let j = Math.max(0, i - order); j < i; j++) solution[i] = solution[i]! - matrix[i * count + j]! * solution[j]!;
          }
          for (let i = count - 1; i >= 0; i--) {
            solution[i] = solution[i]! / matrix[i * count + i]!;
            for (let j = i + 1; j < Math.min(count, i + order + 1); j++) solution[i] = solution[i]! - matrix[j * count + i]! * solution[j]!;
            // Native pads overlap-save audio, but not its repair-enable FIFO.
            // A first window shorter than size only enables its first length slots.
            if (indices[i]! < length) repaired[indices[i]!] = solution[i]!;
          }
        }
      }
      if (options.method) {
        for (let i = 0; i < hop && start + i < length; i++) output[c]![start + i] = repaired[skip + i]!;
      } else {
        for (let i = 0; i < size && start + i < length; i++) {
          output[c]![start + i] = output[c]![start + i]! + repaired[i]! * window![i]!;
        }
      }
    }
  }
  return output;
}

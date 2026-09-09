import { PythonRuntimeError } from "./error.js";

export interface IntegerProgression {
  readonly start: bigint;
  readonly stop: bigint;
  readonly step: bigint;
  /** Exact cardinality; guest len() overflow is checked separately. */
  readonly length: bigint;
}

export function createRange(start: bigint, stop: bigint, step = 1n): IntegerProgression {
  if (step === 0n) throw new PythonRuntimeError("ValueError", "range() arg 3 must not be zero");
  const distance = step > 0n ? stop - start : start - stop;
  const stride = step > 0n ? step : -step;
  const length = distance <= 0n ? 0n : (distance - 1n) / stride + 1n;
  return Object.freeze({ start, stop, step, length });
}

/** Normalize slice bounds without losing the distinction between None and -1. */
export function normalizeSlice(length: bigint, start: bigint | null = null, stop: bigint | null = null, step: bigint | null = null): IntegerProgression {
  if (length < 0n) throw new PythonRuntimeError("ValueError", "length should not be negative");
  step ??= 1n;
  if (step === 0n) throw new PythonRuntimeError("ValueError", "slice step cannot be zero");
  const lower = step < 0n ? -1n : 0n;
  const upper = step < 0n ? length - 1n : length;
  function bound(value: bigint | null, fallback: bigint): bigint {
    if (value === null) return fallback;
    if (value < 0n) value += length;
    return value < lower ? lower : value > upper ? upper : value;
  }
  return createRange(bound(start, step < 0n ? upper : lower), bound(stop, step < 0n ? lower : upper), step);
}

export function rangeItem(range: IntegerProgression, index: bigint): bigint {
  if (index < 0n) index += range.length;
  if (index < 0n || index >= range.length) throw new PythonRuntimeError("IndexError", "range object index out of range");
  return range.start + index * range.step;
}

/** Constant-count arithmetic search for exact integers, not generic guest equality. */
export function rangeIndexOf(range: IntegerProgression, value: bigint): bigint | undefined {
  const offset = value - range.start;
  if (offset % range.step !== 0n) return undefined;
  const index = offset / range.step;
  return index >= 0n && index < range.length ? index : undefined;
}

export function sliceRange(range: IntegerProgression, start: bigint | null = null, stop: bigint | null = null, step: bigint | null = null): IntegerProgression {
  const indices = normalizeSlice(range.length, start, stop, step);
  return createRange(range.start + indices.start * range.step, range.start + indices.stop * range.step, range.step * indices.step);
}

export function rangesEqual(a: IntegerProgression, b: IntegerProgression): boolean {
  if (a.length !== b.length) return false;
  return a.length === 0n || (a.start === b.start && (a.length === 1n || a.step === b.step));
}

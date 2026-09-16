import { ValueError } from "./errors.js";

export function sequenceSlice<T>(
  values: readonly T[],
  start?: number,
  end?: number,
  step = 1
): readonly T[] {
  if (
    !Number.isSafeInteger(step) ||
    step === 0 ||
    [start, end].some((value) => value !== undefined && !Number.isSafeInteger(value))
  )
    throw new ValueError("Invalid sequence slice bounds.");
  const length = values.length;
  const normalize = (value: number) =>
    Math.max(
      step > 0 ? 0 : -1,
      Math.min(step > 0 ? length : length - 1, value < 0 ? length + value : value)
    );
  const first = start === undefined ? (step > 0 ? 0 : length - 1) : normalize(start);
  const last = end === undefined ? (step > 0 ? length : -1) : normalize(end);
  const result: T[] = [];
  for (let i = first; step > 0 ? i < last : i > last; i += step) result.push(values[i]!);
  return Object.freeze(result);
}

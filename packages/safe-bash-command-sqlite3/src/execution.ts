import { yieldTurn } from "safe-bash-contracts/yield";

export type SqlSteps<T> = Generator<void, T, void>;
export type StepResult<T> = T extends SqlSteps<infer R> ? R : never;

export function runSynchronously<T>(steps: SqlSteps<T>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export async function runCooperatively<T>(steps: SqlSteps<T>, signal: AbortSignal): Promise<T> {
  let work = 0;
  try {
    signal.throwIfAborted();
    let step = steps.next();
    while (!step.done) {
      signal.throwIfAborted();
      if (++work === 2048) {
        work = 0;
        await yieldTurn(signal);
      }
      step = steps.next();
    }
    signal.throwIfAborted();
    return step.value;
  } finally {
    steps.return(undefined as never);
  }
}

type Callback<T, R, C> = (this: C, value: T, index: number, values: T[]) => SqlSteps<R>;

export function* stepMap<T, R, C>(values: T[], callback: Callback<T, R, C>, context: C): SqlSteps<R[]> {
  const result: R[] = [];
  for (let i = 0; i < values.length; i++) {
    yield;
    result.push(yield* callback.call(context, values[i]!, i, values));
  }
  return result;
}

export function* stepFilter<T, C>(values: T[], callback: Callback<T, unknown, C>, context: C): SqlSteps<T[]> {
  const result: T[] = [];
  for (let i = 0; i < values.length; i++) {
    yield;
    if (yield* callback.call(context, values[i]!, i, values)) result.push(values[i]!);
  }
  return result;
}

export function* stepFlatMap<T, R, C>(values: T[], callback: Callback<T, R[], C>, context: C): SqlSteps<R[]> {
  const result: R[] = [];
  for (let i = 0; i < values.length; i++) {
    yield;
    for (const value of yield* callback.call(context, values[i]!, i, values)) {
      yield;
      result.push(value);
    }
  }
  return result;
}

export function* stepReduce<T, R, C = unknown>(
  values: T[],
  callback: (this: C, previous: R, value: T) => SqlSteps<R>,
  initial: R,
  context: C
): SqlSteps<R> {
  let result = initial;
  for (const value of values) {
    yield;
    result = yield* callback.call(context, result, value);
  }
  return result;
}

// Stable bottom-up merge sort can suspend between comparisons, unlike native sort.
export function* stepSort<T, C>(
  values: T[],
  compare: (this: C, left: T, right: T) => SqlSteps<number>,
  context: C
): SqlSteps<T[]> {
  let source = values.slice();
  let target = new Array<T>(values.length);
  for (let width = 1; width < values.length; width *= 2) {
    for (let start = 0; start < values.length; start += 2 * width) {
      const middle = Math.min(start + width, values.length);
      const end = Math.min(start + 2 * width, values.length);
      let left = start;
      let right = middle;
      for (let i = start; i < end; i++) {
        yield;
        if (left < middle && (right >= end || (yield* compare.call(context, source[left]!, source[right]!)) <= 0))
          target[i] = source[left++]!;
        else target[i] = source[right++]!;
      }
    }
    [source, target] = [target, source];
  }
  for (let i = 0; i < values.length; i++) {
    yield;
    values[i] = source[i]!;
  }
  return values;
}

/** Work-based scheduling remains effective when host clocks are frozen. */
export const WORK_QUANTUM = 16_384;

export async function runCooperatively<T>(steps: Generator<void, T>, signal: AbortSignal): Promise<T> {
  try {
    signal.throwIfAborted();
    let result = steps.next();
    while (!result.done) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      signal.throwIfAborted();
      result = steps.next();
    }
    return result.value;
  } finally { steps.return(undefined as never); }
}

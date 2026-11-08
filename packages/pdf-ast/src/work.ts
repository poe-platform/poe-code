export function drainWork<T>(work: Generator<void, T, void>): T {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

export async function drainWorkAsync<T>(work: Generator<void, T, void>, signal?: AbortSignal): Promise<T> {
  let turns = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const step = work.next();
      if (step.done) return step.value;
      if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally { work.return(undefined as T); }
}

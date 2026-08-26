import type { AcpEvent } from "./acp/types.js";
import type { SpawnHandle } from "./retry.js";

export type SpawnParallelTuple<TService, TOptions> = readonly [
  service: TService,
  options: TOptions
];

export type SpawnParallelThunk<TResult extends { exitCode: number }> = (
  signal?: AbortSignal
) => SpawnHandle<TResult>;

export type SpawnParallelCall<
  TService,
  TOptions,
  TResult extends { exitCode: number }
> = SpawnParallelTuple<TService, TOptions> | SpawnParallelThunk<TResult>;

export type SpawnParallelOptions = {
  maxConcurrent?: number;
  failFast?: boolean;
  signal?: AbortSignal;
};

export class SpawnParallelError<TResult extends { exitCode: number }> extends Error {
  readonly index: number;
  readonly result: TResult;
  readonly results: Array<TResult | undefined>;

  constructor(index: number, result: TResult, results: Array<TResult | undefined>) {
    super(`spawn.parallel call ${index} failed with exit code ${result.exitCode}.`);
    this.name = "SpawnParallelError";
    this.index = index;
    this.result = result;
    this.results = results;
  }
}

export function createSpawnParallel<
  TService,
  TOptions extends { signal?: AbortSignal },
  TResult extends { exitCode: number }
>(
  spawnOnce: (service: TService, options: TOptions) => SpawnHandle<TResult>
): (
  calls: Array<SpawnParallelCall<TService, TOptions, TResult>>,
  options?: SpawnParallelOptions
) => Promise<TResult[]> {
  return async function parallel(calls, options = {}) {
    if (calls.length === 0) {
      return [];
    }

    const maxConcurrent = normalizeMaxConcurrent(options.maxConcurrent);
    const failFast = options.failFast ?? true;
    const group = new AbortController();
    const results: Array<TResult | undefined> = new Array(calls.length);
    const errors: unknown[] = [];
    let nextIndex = 0;
    let primaryFailure: { reason: unknown } | undefined;

    const removeParentAbort = linkParentAbort(options.signal, group, (error) => {
      primaryFailure ??= { reason: error };
    });

    const worker = async () => {
      while (primaryFailure === undefined) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= calls.length) {
          return;
        }

        try {
          const result = await runParallelCall(calls[index], spawnOnce, group.signal);
          results[index] = result;

          if (failFast && result.exitCode !== 0) {
            const error = new SpawnParallelError(index, result, results);
            primaryFailure ??= { reason: error };
            group.abort(error);
            return;
          }
        } catch (error) {
          if (failFast || group.signal.aborted) {
            primaryFailure ??= { reason: error };
            group.abort(error);
            return;
          }

          errors.push(error);
        }
      }
    };

    try {
      await Promise.allSettled(
        Array.from({ length: Math.min(maxConcurrent, calls.length) }, () => worker())
      );
    } finally {
      removeParentAbort();
    }

    if (primaryFailure !== undefined) {
      throw primaryFailure.reason;
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "spawn.parallel failed before every call returned a result.");
    }

    return results as TResult[];
  };
}

async function runParallelCall<
  TService,
  TOptions extends { signal?: AbortSignal },
  TResult extends { exitCode: number }
>(
  call: SpawnParallelCall<TService, TOptions, TResult>,
  spawnOnce: (service: TService, options: TOptions) => SpawnHandle<TResult>,
  signal: AbortSignal
): Promise<TResult> {
  throwIfAborted(signal);

  if (typeof call === "function") {
    const handle = call(signal);
    const [result] = await Promise.all([handle.result, drainEvents(handle.events)]);
    return result;
  }

  if (!isSpawnTuple(call)) {
    throw new Error("spawn.parallel calls must be [service, options] tuples or spawn thunks.");
  }

  const { options, cleanup } = withAbortSignal(call[1], signal);
  try {
    const handle = spawnOnce(call[0], options);
    const [result] = await Promise.all([handle.result, drainEvents(handle.events)]);
    return result;
  } finally {
    cleanup();
  }
}

async function drainEvents(events: AsyncIterable<AcpEvent>): Promise<void> {
  for await (const ignoredEvent of events) {
    void ignoredEvent;
    // Drain the stream so streaming providers can complete while parallel returns results only.
  }
}

function normalizeMaxConcurrent(maxConcurrent: number | undefined): number {
  const value = maxConcurrent ?? 4;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("spawn.parallel maxConcurrent must be an integer greater than or equal to 1.");
  }
  return value;
}

function isSpawnTuple<TService, TOptions>(
  call: SpawnParallelCall<TService, TOptions, { exitCode: number }>
): call is SpawnParallelTuple<TService, TOptions> {
  return Array.isArray(call) && call.length === 2;
}

function withAbortSignal<TOptions extends { signal?: AbortSignal }>(
  options: TOptions,
  signal: AbortSignal
): { options: TOptions; cleanup(): void } {
  if (!options.signal) {
    return {
      options: { ...options, signal },
      cleanup() {}
    };
  }

  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };

  if (signal.aborted || options.signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
    options.signal.addEventListener("abort", abort, { once: true });
  }

  return {
    options: { ...options, signal: controller.signal },
    cleanup() {
      signal.removeEventListener("abort", abort);
      options.signal?.removeEventListener("abort", abort);
    }
  };
}

function linkParentAbort(
  parentSignal: AbortSignal | undefined,
  group: AbortController,
  setFailure: (error: Error) => void
): () => void {
  if (!parentSignal) {
    return () => {};
  }

  const abort = () => {
    const error = createAbortError();
    setFailure(error);
    group.abort(error);
  };

  if (parentSignal.aborted) {
    abort();
    return () => {};
  }

  parentSignal.addEventListener("abort", abort, { once: true });
  return () => parentSignal.removeEventListener("abort", abort);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error("Agent spawn parallel aborted");
  error.name = "AbortError";
  return error;
}

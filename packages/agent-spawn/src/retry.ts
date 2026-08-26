import type { AcpEvent } from "./acp/types.js";

export type SpawnRetryOptions<TResult extends { exitCode: number }> = {
  maxAttempts: number;
  backoffMs: number;
  isRetryable?: (result: TResult) => boolean;
};

export type SpawnHandle<TResult> = {
  events: AsyncIterable<AcpEvent>;
  result: Promise<TResult>;
};

export type SpawnRetryFunction<
  TOptions extends { signal?: AbortSignal },
  TResult extends { exitCode: number }
> = (
  service: string,
  options: TOptions,
  retryOptions: SpawnRetryOptions<TResult>
) => SpawnHandle<TResult>;

type EventQueue<T> = AsyncIterable<T> & {
  push(value: T): void;
  close(): void;
  fail(error: unknown): void;
};

const retryableExitCodes = new Set([1, 124, 125, 137]);
const maxBackoffMs = 30_000;

export function createSpawnRetry<
  TOptions extends { signal?: AbortSignal },
  TResult extends { exitCode: number }
>(
  spawnOnce: (service: string, options: TOptions) => SpawnHandle<TResult>
): SpawnRetryFunction<TOptions, TResult> {
  return (service, options, retryOptions) => {
    const normalizedRetryOptions = normalizeRetryOptions(retryOptions);
    const queue = createEventQueue<AcpEvent>();
    const result = runRetryingSpawn({
      service,
      options,
      retryOptions: normalizedRetryOptions,
      spawnOnce,
      emit: queue.push
    })
      .then((value) => {
        queue.close();
        return value;
      })
      .catch((error: unknown) => {
        queue.fail(error);
        throw error;
      });

    return {
      events: queue,
      result
    };
  };
}

export function defaultIsRetryable(result: { exitCode: number }): boolean {
  return retryableExitCodes.has(result.exitCode);
}

export function calculateBackoffMs(baseBackoffMs: number, completedAttempt: number): number {
  return Math.min(baseBackoffMs * 2 ** (completedAttempt - 1), maxBackoffMs);
}

function normalizeRetryOptions<TResult extends { exitCode: number }>(
  retryOptions: SpawnRetryOptions<TResult>
): Required<SpawnRetryOptions<TResult>> {
  if (!Number.isInteger(retryOptions.maxAttempts) || retryOptions.maxAttempts < 1) {
    throw new Error("spawn.retry maxAttempts must be an integer greater than or equal to 1.");
  }

  if (!Number.isFinite(retryOptions.backoffMs) || retryOptions.backoffMs < 0) {
    throw new Error("spawn.retry backoffMs must be a non-negative finite number.");
  }

  return {
    maxAttempts: retryOptions.maxAttempts,
    backoffMs: retryOptions.backoffMs,
    isRetryable: retryOptions.isRetryable ?? defaultIsRetryable
  };
}

async function runRetryingSpawn<
  TOptions extends { signal?: AbortSignal },
  TResult extends { exitCode: number }
>(input: {
  service: string;
  options: TOptions;
  retryOptions: Required<SpawnRetryOptions<TResult>>;
  spawnOnce: (service: string, options: TOptions) => SpawnHandle<TResult>;
  emit: (event: AcpEvent) => void;
}): Promise<TResult> {
  for (let attempt = 1; attempt <= input.retryOptions.maxAttempts; attempt += 1) {
    throwIfAborted(input.options.signal);

    const handle = input.spawnOnce(input.service, input.options);
    const events = forwardAttemptEvents(handle.events, attempt, input.emit);
    const [result] = await Promise.all([handle.result, events]);

    const isLastAttempt = attempt >= input.retryOptions.maxAttempts;
    if (result.exitCode === 0 || isLastAttempt || !input.retryOptions.isRetryable(result)) {
      return result;
    }

    const delayMs = calculateBackoffMs(input.retryOptions.backoffMs, attempt);
    input.emit(createWaitEvent(attempt, delayMs));
    await sleep(delayMs, input.options.signal);
  }

  throw new Error("spawn.retry reached an unreachable retry state.");
}

async function forwardAttemptEvents(
  events: AsyncIterable<AcpEvent>,
  attempt: number,
  emit: (event: AcpEvent) => void
): Promise<void> {
  for await (const event of events) {
    emit(prefixEvent(event, attempt));
  }
}

function prefixEvent(event: AcpEvent, attempt: number): AcpEvent {
  const prefix = `attempt: ${attempt}`;

  if (event.event === "agent_message" || event.event === "reasoning") {
    return { ...event, text: `${prefix} ${event.text}` };
  }

  if (event.event === "error") {
    return { ...event, message: `${prefix} ${event.message}` };
  }

  if (event.event === "tool_start") {
    return { ...event, title: `${prefix} ${event.title}` };
  }

  if (event.event === "tool_complete") {
    return { ...event, path: `${prefix} ${event.path}` };
  }

  return {
    ...event,
    _meta: {
      ...(typeof event._meta === "object" && event._meta !== null ? event._meta : {}),
      attempt
    }
  };
}

function createWaitEvent(attempt: number, delayMs: number): AcpEvent {
  return {
    event: "agent_message",
    text: `attempt: ${attempt} wait ${delayMs}ms before retry`
  };
}

function sleep(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error("Agent spawn retry aborted");
  error.name = "AbortError";
  return error;
}

function createEventQueue<T>(): EventQueue<T> {
  const values: T[] = [];
  const waiters: Array<{
    resolve(value: IteratorResult<T>): void;
    reject(error: unknown): void;
  }> = [];
  let closed = false;
  let failure: unknown;

  const next = (): Promise<IteratorResult<T>> => {
    if (values.length > 0) {
      return Promise.resolve({ value: values.shift() as T, done: false });
    }

    if (failure !== undefined) {
      return Promise.reject(failure);
    }

    if (closed) {
      return Promise.resolve({ value: undefined, done: true });
    }

    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  };

  return {
    push(value) {
      if (closed || failure !== undefined) {
        return;
      }

      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ value, done: false });
        return;
      }

      values.push(value);
    },
    close() {
      if (closed || failure !== undefined) {
        return;
      }

      closed = true;
      for (const waiter of waiters.splice(0)) {
        waiter.resolve({ value: undefined, done: true });
      }
    },
    fail(error) {
      if (closed || failure !== undefined) {
        return;
      }

      failure = error;
      for (const waiter of waiters.splice(0)) {
        waiter.reject(error);
      }
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const item = await next();
        if (item.done) {
          return;
        }
        yield item.value;
      }
    }
  };
}

export type GeneratorCompletion = {
  type: "normal" | "return" | "throw";
  value: unknown;
};

export type GeneratorChannel = {
  next(value?: unknown): Promise<IteratorResult<unknown>>;
  return(value?: unknown): Promise<IteratorResult<unknown>>;
  throw(error?: unknown): Promise<IteratorResult<unknown>>;
};

type Deferred<T> = {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
};

type ChannelSignal =
  | { type: "complete"; value: unknown }
  | { type: "error"; error: unknown }
  | { type: "yield"; value: unknown };

export function createGeneratorChannel(
  body: (yieldValue: (value?: unknown) => Promise<GeneratorCompletion>) => Promise<unknown>
): GeneratorChannel {
  let state: "unstarted" | "running" | "suspended" | "done" = "unstarted";
  let signal = deferred<ChannelSignal>();
  let resume: Deferred<GeneratorCompletion> | undefined;
  const start = deferred<void>();
  const bodyPromise = start.promise.then(() => body(yieldValue));

  void bodyPromise.then(
    (value) => {
      if (state === "done") {
        return;
      }
      state = "done";
      signal.resolve({ type: "complete", value });
    },
    (error: unknown) => {
      if (state === "done") {
        return;
      }
      state = "done";
      signal.resolve({ type: "error", error });
    }
  );
  void bodyPromise.catch(() => undefined);

  async function yieldValue(value?: unknown): Promise<GeneratorCompletion> {
    resume = deferred<GeneratorCompletion>();
    state = "suspended";
    signal.resolve({ type: "yield", value });
    return resume.promise;
  }

  async function deliver(completion: GeneratorCompletion): Promise<IteratorResult<unknown>> {
    if (state === "done") {
      if (completion.type === "return") {
        return { value: completion.value, done: true };
      }
      if (completion.type === "throw") {
        throw completion.value;
      }
      return { value: undefined, done: true };
    }

    if (state === "running") {
      throw new TypeError("Generator is already running.");
    }

    if (state === "unstarted") {
      if (completion.type === "return") {
        state = "done";
        return { value: completion.value, done: true };
      }
      if (completion.type === "throw") {
        state = "done";
        throw completion.value;
      }

      state = "running";
      start.resolve();
    } else {
      state = "running";
      signal = deferred<ChannelSignal>();
      const pendingResume = resume;
      resume = undefined;
      pendingResume?.resolve(completion);
    }

    const settled = await signal.promise;
    if (settled.type === "yield") {
      return { value: settled.value, done: false };
    }
    if (settled.type === "error") {
      throw settled.error;
    }
    return { value: settled.value, done: true };
  }

  return {
    next: (value) => deliver({ type: "normal", value }),
    return: (value) => deliver({ type: "return", value }),
    throw: (error) => deliver({ type: "throw", value: error })
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

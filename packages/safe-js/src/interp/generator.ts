import { enterRunningState } from "./running-state.js";

export type GeneratorCompletion = {
  type: "normal" | "return" | "throw";
  value: unknown;
};

export type GeneratorChannel = {
  next(value?: unknown): Promise<IteratorResult<unknown>>;
  return(value?: unknown): Promise<IteratorResult<unknown>>;
  throw(error?: unknown): Promise<IteratorResult<unknown>>;
  snapshot(): GeneratorChannelSnapshot;
};

export type GeneratorChannelSnapshot = {
  yieldNodeId?: number;
  sent: GeneratorCompletion[];
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
  body: (
    yieldValue: (value?: unknown, yieldNodeId?: number) => Promise<GeneratorCompletion>
  ) => Promise<unknown>
): GeneratorChannel {
  let state: "unstarted" | "running" | "suspended" | "done" = "unstarted";
  let signal = deferred<ChannelSignal>();
  let resume: Deferred<GeneratorCompletion> | undefined;
  const start = deferred<void>();
  const sent: GeneratorCompletion[] = [];
  let yieldNodeId: number | undefined;
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

  async function yieldValue(value?: unknown, nodeId?: number): Promise<GeneratorCompletion> {
    resume = deferred<GeneratorCompletion>();
    yieldNodeId = nodeId;
    state = "suspended";
    signal.resolve({ type: "yield", value });
    return resume.promise;
  }

  async function deliver(completion: GeneratorCompletion): Promise<IteratorResult<unknown>> {
    const leaveRunning = enterRunningState(channelIdentity);
    try {
      if (state === "done") {
        if (completion.type === "return") {
          return { value: completion.value, done: true };
        }
        if (completion.type === "throw") {
          throw completion.value;
        }
        return { value: undefined, done: true };
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
        sent.push(completion);
        start.resolve();
      } else {
        state = "running";
        sent.push(completion);
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
    } finally {
      leaveRunning();
    }
  }

  const channelIdentity = {};

  return {
    next: (value) => deliver({ type: "normal", value }),
    return: (value) => deliver({ type: "return", value }),
    throw: (error) => deliver({ type: "throw", value: error }),
    snapshot: () => ({
      ...(yieldNodeId === undefined ? {} : { yieldNodeId }),
      sent: sent.map((completion) => ({ ...completion }))
    })
  };
}

export function restoreGeneratorChannel(
  body: Parameters<typeof createGeneratorChannel>[0],
  snapshot: GeneratorChannelSnapshot
): GeneratorChannel {
  const channel = createGeneratorChannel(body);
  const sent = snapshot.sent.map((completion) => ({ ...completion }));
  let restored = false;
  let restoring: Promise<void> | undefined;

  const ensureRestored = (): Promise<void> => {
    if (restored) {
      return Promise.resolve();
    }
    restoring ??= replay();
    return restoring;
  };

  const deliver = async (
    method: "next" | "return" | "throw",
    value?: unknown
  ): Promise<IteratorResult<unknown>> => {
    await ensureRestored();
    sent.push({
      type: method === "next" ? "normal" : method,
      value
    });
    return channel[method](value);
  };

  return {
    next: (value) => deliver("next", value),
    return: (value) => deliver("return", value),
    throw: (error) => deliver("throw", error),
    snapshot: () => ({
      yieldNodeId: restored ? channel.snapshot().yieldNodeId : snapshot.yieldNodeId,
      sent: sent.map((completion) => ({ ...completion }))
    })
  };

  async function replay(): Promise<void> {
    const result = await channel.next();
    if (result.done) {
      throw new TypeError("Cannot restore a suspended generator that completed during replay.");
    }

    if (channel.snapshot().yieldNodeId !== snapshot.yieldNodeId) {
      throw new TypeError("Cannot restore generator at the recorded yield expression.");
    }
    restored = true;
  }
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

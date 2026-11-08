import { enterRunningState } from "./running-state.js";
import { createResumableJobContext } from "./jobs.js";

export type GeneratorCompletion = {
  type: "normal" | "return" | "throw";
  value: unknown;
};

export type GeneratorChannel = {
  next(value?: unknown, record?: boolean): Promise<GeneratorChannelResult>;
  return(value?: unknown, record?: boolean): Promise<GeneratorChannelResult>;
  throw(error?: unknown, record?: boolean): Promise<GeneratorChannelResult>;
  snapshot(): GeneratorChannelSnapshot;
};

export type GeneratorChannelResult = IteratorResult<unknown> & { yieldedResult?: unknown };

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
  | { type: "yield"; value: unknown; yieldedResult?: unknown };

export function createGeneratorChannel(
  body: (
    yieldValue: (value?: unknown, yieldNodeId?: number, yieldedResult?: unknown) => Promise<GeneratorCompletion>
  ) => Promise<unknown>
): GeneratorChannel {
  let state: "unstarted" | "running" | "suspended" | "done" = "unstarted";
  let signal = deferred<ChannelSignal>();
  let resume: Deferred<GeneratorCompletion> | undefined;
  const resumeJob = createResumableJobContext();
  const sent: GeneratorCompletion[] = [];
  let yieldNodeId: number | undefined;
  function startBody(): void {
    let bodyPromise: Promise<unknown>;
    try {bodyPromise = body(yieldValue);}
    catch (error) {bodyPromise = Promise.reject(error);}
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
  }

  async function yieldValue(value?: unknown, nodeId?: number, yieldedResult?: unknown): Promise<GeneratorCompletion> {
    resume = deferred<GeneratorCompletion>();
    yieldNodeId = nodeId;
    state = "suspended";
    signal.resolve({ type: "yield", value, yieldedResult });
    return resume.promise;
  }

  async function deliver(completion: GeneratorCompletion, record: boolean): Promise<GeneratorChannelResult> {
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
        if (record) sent.push(completion);
        startBody();
      } else {
        state = "running";
        if (record) sent.push(completion);
        signal = deferred<ChannelSignal>();
        const pendingResume = resume;
        resume = undefined;
        pendingResume?.resolve(completion);
      }

      const settled = await signal.promise;
      if (settled.type === "yield") {
        return { value: settled.value, done: false, ...(settled.yieldedResult === undefined ? {} : { yieldedResult: settled.yieldedResult }) };
      }
      if (settled.type === "error") {
        throw settled.error;
      }
      return { value: settled.value, done: true };
    } finally {
      leaveRunning();
      resumeJob.release();
    }
  }

  const channelIdentity = {};

  return {
    next: (value, record = true) => resumeJob.run(() => deliver({ type: "normal", value }, record)),
    return: (value, record = true) => resumeJob.run(() => deliver({ type: "return", value }, record)),
    throw: (error, record = true) => resumeJob.run(() => deliver({ type: "throw", value: error }, record)),
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
    value?: unknown,
    record = true
  ): Promise<GeneratorChannelResult> => {
    await ensureRestored();
    if (record) sent.push({
      type: method === "next" ? "normal" : method,
      value
    });
    return channel[method](value, record);
  };

  return {
    next: (value, record) => deliver("next", value, record),
    return: (value, record) => deliver("return", value, record),
    throw: (error, record) => deliver("throw", error, record),
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

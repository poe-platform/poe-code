import { AsyncLocalStorage } from "node:async_hooks";
import { setImmediate as yieldToHost } from "node:timers/promises";
import { SandboxError } from "./budget.js";

export type ExecutionControl = {
  readonly executionState: "running" | "pausing" | "paused" | "finished";
  pause(): Promise<void>;
  resume(): void;
};

type PauseRequest = {
  acknowledged: boolean;
  acknowledgement: Promise<void>;
  acknowledge(): void;
  reject(reason: unknown): void;
  continuation: Promise<void>;
  resume(): void;
  interrupt(reason: unknown): void;
};

type ExecutionJob = {
  queue: SandboxJobQueue;
  ownsExecution: boolean;
  prefixParent?: ExecutionJob;
};

const activeJob = new AsyncLocalStorage<ExecutionJob>();

export class SandboxJobQueue {
  private running = false;
  private pending: Array<() => void> = [];
  private ready: Array<() => void> = [];
  private readonly idle: Array<() => void> = [];
  private generation = 0;
  private controlled = false;
  private nodesUntilHostTurn = 4096;
  private pauseRequest?: PauseRequest;
  private finished = false;
  private interruption?: { reason: unknown };
  private detachSignal?: () => void;

  get executionState(): ExecutionControl["executionState"] {
    return this.finished
      ? "finished"
      : this.pauseRequest === undefined
        ? "running"
        : this.pauseRequest.acknowledged
          ? "paused"
          : "pausing";
  }

  enableControl(signal?: AbortSignal): void {
    this.controlled = true;
    if (signal === undefined) return;
    const abort = () => this.interrupt(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    this.detachSignal = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) abort();
  }

  pause(): Promise<void> {
    if (this.finished) return Promise.reject(new Error("Execution is finished."));
    if (this.interruption !== undefined) return Promise.reject(this.interruption.reason);
    let owner = activeJob.getStore();
    while (owner !== undefined && !owner.ownsExecution) owner = owner.prefixParent;
    if (owner?.queue === this) return Promise.reject(new SandboxError("reentry"));
    if (this.pauseRequest !== undefined) return this.pauseRequest.acknowledgement;
    let acknowledge!: () => void;
    let reject!: (reason: unknown) => void;
    let resume!: () => void;
    let interrupt!: (reason: unknown) => void;
    const acknowledgement = new Promise<void>((resolve, fail) => {
      acknowledge = resolve;
      reject = fail;
    });
    const continuation = new Promise<void>((resolve, fail) => {
      resume = resolve;
      interrupt = fail;
    });
    void continuation.catch(() => undefined);
    this.pauseRequest = {
      acknowledged: false,
      acknowledgement,
      acknowledge,
      reject,
      continuation,
      resume,
      interrupt
    };
    if (!this.running) this.advance();
    return acknowledgement;
  }

  resume(): void {
    if (this.finished) throw new Error("Execution is finished.");
    const request = this.pauseRequest;
    if (request === undefined) return;
    if (!request.acknowledged) throw new Error("Wait for pause acknowledgement before resuming.");
    this.pauseRequest = undefined;
    request.resume();
    this.advance();
  }

  interrupt(reason: unknown): void {
    this.interruption ??= { reason };
    const request = this.pauseRequest;
    this.pauseRequest = undefined;
    request?.reject(reason);
    request?.interrupt(reason);
    this.advance();
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.detachSignal?.();
    this.detachSignal = undefined;
    this.interrupt(new Error("Execution is finished."));
  }

  static checkpoint(): Promise<void> | undefined {
    const queue = activeJob.getStore()?.queue;
    if (queue === undefined || !queue.controlled) return;
    if (queue.pauseRequest !== undefined) {
      queue.pauseRequest.acknowledged = true;
      queue.pauseRequest.acknowledge();
      return queue.pauseRequest.continuation;
    }
    if (--queue.nodesUntilHostTurn > 0) return;
    queue.nodesUntilHostTurn = 4096;
    return yieldToHost().then(() => {
      if (queue.pauseRequest === undefined) return;
      queue.pauseRequest.acknowledged = true;
      queue.pauseRequest.acknowledge();
      return queue.pauseRequest.continuation;
    });
  }

  acquire(job: ExecutionJob): Promise<void> {
    if (this.finished)
      return Promise.reject(this.interruption?.reason ?? new Error("Execution is finished."));
    return new Promise((resolve) => {
      this.pending.push(() => {
        this.running = true;
        this.generation += 1;
        job.ownsExecution = true;
        resolve();
      });
      this.advance();
    });
  }

  release(job: ExecutionJob): void {
    job.prefixParent = undefined;
    if (!job.ownsExecution) return;
    job.ownsExecution = false;
    this.running = false;
    this.advance();
  }

  async run<T>(task: () => T | Promise<T>): Promise<T> {
    const job = { queue: this, ownsExecution: false };
    await this.acquire(job);
    return activeJob.run(job, async () => {
      try {
        return await task();
      } finally {
        this.release(job);
      }
    });
  }

  async drain(): Promise<void> {
    let idleTurns = 0;
    while (idleTurns < 20) {
      const generation = this.generation;
      if (this.running || this.pending.length > 0 || this.ready.length > 0)
        await new Promise<void>((resolve) => this.idle.push(resolve));
      await Promise.resolve();
      idleTurns = generation === this.generation ? idleTurns + 1 : 0;
    }
  }

  private advance(): void {
    if (this.running) return;
    if (this.pauseRequest !== undefined) {
      this.pauseRequest.acknowledged = true;
      this.pauseRequest.acknowledge();
      if (this.pending.length === 0 && this.ready.length === 0)
        for (const resolve of this.idle.splice(0)) resolve();
      return;
    }
    if (this.ready.length === 0 && this.pending.length > 0) {
      const empty = this.ready;
      this.ready = this.pending.reverse();
      this.pending = empty;
    }
    const next = this.ready.pop();
    if (next !== undefined) {
      next();
    } else {
      for (const resolve of this.idle.splice(0)) resolve();
    }
  }
}

export function attachExecutionControl<T extends object>(
  target: T,
  queue: SandboxJobQueue,
  signal?: AbortSignal
): T & ExecutionControl {
  queue.enableControl(signal);
  return Object.defineProperties(target, {
    executionState: { get: () => queue.executionState },
    pause: { value: queue.pause.bind(queue) },
    resume: { value: queue.resume.bind(queue) }
  }) as T & ExecutionControl;
}

export function runPromiseJob<T>(task: () => T | Promise<T>): Promise<T> {
  const job = activeJob.getStore();
  return job === undefined ? Promise.resolve().then(task) : job.queue.run(task);
}

export function runAsyncPrefix<T>(task: () => Promise<T>): Promise<T> {
  const parent = activeJob.getStore();
  if (parent === undefined) return task();
  let owner: ExecutionJob | undefined = parent;
  while (owner !== undefined && !owner.ownsExecution) owner = owner.prefixParent;
  if (owner === undefined) return parent.queue.run(task);
  const job = { queue: parent.queue, ownsExecution: false, prefixParent: parent };
  return activeJob.run(job, async () => {
    try {
      return await task();
    } finally {
      job.queue.release(job);
    }
  });
}

export async function suspendJob<T>(pending: Promise<T>): Promise<T> {
  const job = activeJob.getStore();
  if (job === undefined) return pending;
  job.queue.release(job);
  try {
    return await pending;
  } finally {
    await job.queue.acquire(job);
  }
}

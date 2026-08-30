import { AsyncLocalStorage } from "node:async_hooks";

import type { ErrorSourceSpan } from "../error/shape.js";
import { SandboxError } from "./budget.js";
import type { SandboxPromise, SandboxValue } from "./values.js";

type TrackedPromise = {
  observed: boolean;
  promise: SandboxPromise;
  rejectionReason?: SandboxValue;
  rejected: boolean;
};

export class SandboxPromiseRejectionTracker {
  private readonly records = new Set<TrackedPromise>();
  private readonly recordsByPromise = new WeakMap<SandboxPromise, TrackedPromise>();
  private fatalRejection: SandboxError | undefined;
  private readonly fatalWaiters = new Set<(error: SandboxError) => void>();

  get failure(): SandboxError | undefined {
    return this.fatalRejection;
  }

  onFatalRejection(interrupt: (error: SandboxError) => void): () => void {
    if (this.fatalRejection === undefined) this.fatalWaiters.add(interrupt);
    else interrupt(this.fatalRejection);
    return () => this.fatalWaiters.delete(interrupt);
  }

  interruptOnFatalRejection(pending: Promise<SandboxValue>): Promise<SandboxValue> {
    return new Promise((resolve, reject) => {
      const detach = this.onFatalRejection(reject);
      pending.then(
        (value) => {
          detach();
          resolve(value);
        },
        (reason: unknown) => {
          detach();
          reject(reason);
        }
      );
    });
  }

  observe(promise: SandboxPromise): void {
    const record = this.recordsByPromise.get(promise);
    if (record !== undefined) {
      record.observed = true;
    }
  }

  track(promise: SandboxPromise, outcome?: Promise<SandboxValue>): void {
    const existing = this.recordsByPromise.get(promise);
    if (existing !== undefined && outcome === undefined) {
      return;
    }

    const record: TrackedPromise = existing ?? {
      observed: false,
      promise,
      rejected: false
    };
    this.records.add(record);
    this.recordsByPromise.set(promise, record);

    const pending = outcome ?? promise.promise;
    pending.then(
      () => undefined,
      (reason: SandboxValue) => {
        if (
          this.fatalRejection === undefined &&
          reason instanceof SandboxError &&
          (reason.code === "budgetExceeded" || reason.code === "reentry")
        ) {
          this.fatalRejection = reason;
          for (const interrupt of this.fatalWaiters) interrupt(reason);
          this.fatalWaiters.clear();
        }
        if (record.rejected) return;
        record.rejected = true;
        record.rejectionReason = reason;
      }
    );
    pending.catch(() => undefined);
  }

  async findUnhandledRejection(): Promise<
    | {
        reason: SandboxValue | undefined;
        span: ErrorSourceSpan | undefined;
      }
    | undefined
  > {
    await flushPromiseJobs();

    if (this.fatalRejection !== undefined) throw this.fatalRejection;

    for (const record of this.records) {
      if (record.rejected && !record.observed) {
        return {
          reason: record.rejectionReason,
          span: record.promise.span
        };
      }
    }

    return undefined;
  }
}

const activePromiseTracker = new AsyncLocalStorage<SandboxPromiseRejectionTracker>();
const fatalRejectionCleanup = new AsyncLocalStorage<boolean>();

export function assertPromiseExecutionAllowed(): void {
  const failure = activePromiseTracker.getStore()?.failure;
  if (failure !== undefined && fatalRejectionCleanup.getStore() !== true) throw failure;
}

export function onFatalPromiseRejection(
  interrupt: (error: SandboxError) => void
): (() => void) | undefined {
  if (fatalRejectionCleanup.getStore() === true) return undefined;
  return activePromiseTracker.getStore()?.onFatalRejection(interrupt);
}

export function interruptOnFatalPromiseRejection(
  pending: Promise<SandboxValue>
): Promise<SandboxValue> {
  if (fatalRejectionCleanup.getStore() === true) return pending;
  return activePromiseTracker.getStore()?.interruptOnFatalRejection(pending) ?? pending;
}

export function withFatalPromiseCleanup<TResult>(callback: () => TResult): TResult {
  return fatalRejectionCleanup.run(true, callback);
}

export function createSandboxPromiseRejectionTracker(): SandboxPromiseRejectionTracker {
  return new SandboxPromiseRejectionTracker();
}

export function observeSandboxPromise(promise: SandboxPromise): void {
  activePromiseTracker.getStore()?.observe(promise);
}

export function trackSandboxPromise(
  promise: SandboxPromise,
  outcome?: Promise<SandboxValue>
): void {
  activePromiseTracker.getStore()?.track(promise, outcome);
}

export function withSandboxPromiseRejectionTracker<TResult>(
  tracker: SandboxPromiseRejectionTracker,
  callback: () => TResult
): TResult {
  return activePromiseTracker.run(tracker, callback);
}

async function flushPromiseJobs(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

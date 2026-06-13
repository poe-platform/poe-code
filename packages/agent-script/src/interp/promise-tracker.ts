import { AsyncLocalStorage } from "node:async_hooks";

import type { ErrorSourceSpan } from "../error/shape.js";
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

  observe(promise: SandboxPromise): void {
    const record = this.recordsByPromise.get(promise);
    if (record !== undefined) {
      record.observed = true;
    }
  }

  track(promise: SandboxPromise): void {
    if (this.recordsByPromise.has(promise)) {
      return;
    }

    const record: TrackedPromise = {
      observed: false,
      promise,
      rejected: false
    };
    this.records.add(record);
    this.recordsByPromise.set(promise, record);

    promise.promise.then(
      () => undefined,
      (reason: SandboxValue) => {
        record.rejected = true;
        record.rejectionReason = reason;
      }
    );
    promise.promise.catch(() => undefined);
  }

  async findUnhandledRejection(): Promise<
    | {
        reason: SandboxValue | undefined;
        span: ErrorSourceSpan | undefined;
      }
    | undefined
  > {
    await flushPromiseJobs();

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

export function createSandboxPromiseRejectionTracker(): SandboxPromiseRejectionTracker {
  return new SandboxPromiseRejectionTracker();
}

export function observeSandboxPromise(promise: SandboxPromise): void {
  activePromiseTracker.getStore()?.observe(promise);
}

export function trackSandboxPromise(promise: SandboxPromise): void {
  activePromiseTracker.getStore()?.track(promise);
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

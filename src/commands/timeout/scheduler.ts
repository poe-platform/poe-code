import { performance } from "node:perf_hooks";
import { clearTimeout as nodeClearTimeout, setTimeout as nodeSetTimeout } from "node:timers";
import type { TimeoutScheduler } from "./index.js";

export interface SchedulerBinding {
  readonly receiver: unknown;
  readonly now: TimeoutScheduler["now"];
  readonly setTimeout: TimeoutScheduler["setTimeout"];
  readonly clearTimeout: TimeoutScheduler["clearTimeout"];
}
export const defaultSchedulerBinding: SchedulerBinding = Object.freeze({
  receiver: performance,
  now: performance.now,
  setTimeout: nodeSetTimeout,
  clearTimeout: nodeClearTimeout as TimeoutScheduler["clearTimeout"],
});

export interface Deadline {
  readonly signal: AbortSignal;
  readonly deadlineReason: object;
  readonly timerFailureReason: object;
  readonly retire: () => Promise<void>;
  start(): void;
}

function clock(binding: SchedulerBinding, previous?: number): number {
  const sample = Reflect.apply(binding.now, binding.receiver, []);
  if (typeof sample !== "number" || !Number.isFinite(sample) || Math.abs(sample) > Number.MAX_SAFE_INTEGER
    || (previous !== undefined && sample < previous)) {
    throw new RangeError("Invalid timeout scheduler clock sample");
  }
  return sample;
}

export function createDeadline(binding: SchedulerBinding, duration: number, maximumChunk: number): Deadline {
  const controller = new AbortController();
  const deadlineReason = Object.freeze({});
  const timerFailureReason = Object.freeze({});
  let admissionOpen = true;
  let remaining = duration;
  let previous = 0;
  let handle: unknown;
  let handleLive = false;
  let cleanupFailed = false;
  let cleanupFailure: unknown;
  let retirement: Promise<void> | undefined;

  const rememberCleanupFailure = (error: unknown): void => {
    if (!cleanupFailed) {
      cleanupFailed = true;
      cleanupFailure = error;
    }
  };

  const clearLiveHandle = (): void => {
    if (!handleLive) return;
    const current = handle;
    handleLive = false;
    handle = undefined;
    try { Reflect.apply(binding.clearTimeout, binding.receiver, [current]); }
    catch (error) {
      rememberCleanupFailure(error);
      throw error;
    }
  };

  const failTimer = (): void => {
    admissionOpen = false;
    controller.abort(timerFailureReason);
  };

  const arm = (): void => {
    const milliseconds = Math.min(maximumChunk, Math.max(1, Math.ceil(remaining)));
    handle = Reflect.apply(binding.setTimeout, binding.receiver, [wake, milliseconds]);
    handleLive = true;
  };

  const wake = (): void => {
    if (!admissionOpen) return;
    let sample: number;
    try { sample = clock(binding, previous); }
    catch {
      failTimer();
      return;
    }
    remaining -= sample - previous;
    previous = sample;
    if (remaining <= 0) {
      admissionOpen = false;
      controller.abort(deadlineReason);
      return;
    }
    try {
      clearLiveHandle();
      arm();
    } catch {
      failTimer();
    }
  };

  const retire = (): Promise<void> => {
    if (retirement === undefined) {
      admissionOpen = false;
      try {
        clearLiveHandle();
        if (cleanupFailed) throw cleanupFailure;
        retirement = Promise.resolve();
      } catch (error) {
        retirement = Promise.reject(error);
      }
    }
    return retirement;
  };

  return {
    signal: controller.signal,
    deadlineReason,
    timerFailureReason,
    retire,
    start() {
      previous = clock(binding);
      arm();
    },
  };
}

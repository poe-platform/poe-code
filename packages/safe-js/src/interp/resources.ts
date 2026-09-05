import { AsyncLocalStorage } from "node:async_hooks";
import type { Budget } from "./budget.js";

export type RunResources = {
  signal: AbortSignal;
  // Cancellation is catchable; suspended references survive until disposal.
  referenceReleases: Set<() => void>;
  add(close: () => Promise<void>): void;
};

export const runResources = new AsyncLocalStorage<RunResources>();

export function retainValues(
  budget: Budget,
  values: () => Iterable<unknown>
): () => void {
  const retained = {};
  budget.setRetainedValues(retained, values);
  const pending = runResources.getStore()?.referenceReleases;
  const release = () => {
    budget.setRetainedValues(retained, undefined);
    pending?.delete(release);
  };
  pending?.add(release);
  return release;
}

export async function withRunResources<Result>(
  signal: AbortSignal | undefined,
  execute: () => Promise<Result>
): Promise<Result> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  const cleanups = new Set<() => Promise<void>>();
  const resources: RunResources = {
    signal: controller.signal,
    referenceReleases: new Set(),
    add(close) {
      cleanups.add(close);
    }
  };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  let result!: Result;
  let failure: { reason: unknown } | undefined;
  let errors: unknown[] = [];
  try {
    result = await runResources.run(resources, execute);
  } catch (error) {
    failure = { reason: error };
  } finally {
    signal?.removeEventListener("abort", cancel);
    controller.abort(new Error("SafeJS run finished."));
    for (const release of resources.referenceReleases) release();
    resources.referenceReleases.clear();
    const outcomes = await Promise.allSettled(
      [...cleanups].map((close) => Promise.resolve().then(close))
    );
    errors = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
  }
  if (failure !== undefined) throw failure.reason;
  if (errors.length > 0) throw new AggregateError(errors, "SafeJS resource cleanup failed.");
  return result;
}

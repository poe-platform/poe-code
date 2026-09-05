import { AsyncLocalStorage } from "node:async_hooks";
import { collectionIteratorState, isSandboxCollectionIterator } from "./collection-iterator.js";
import { getSandboxPrototype } from "./object-model.js";
import {
  createSandboxPromise,
  isSandboxClosure,
  isSandboxMap,
  isSandboxPromise,
  isSandboxSet,
  type SandboxCallContext,
  type SandboxClosure,
  type SandboxPromise,
  type SandboxValue
} from "./values.js";
import {
  assertPromiseExecutionAllowed,
  interruptOnFatalPromiseRejection,
  onFatalPromiseRejection,
  observeSandboxPromise,
  trackSandboxPromise
} from "./promise-tracker.js";
import { replaceErrorStack } from "../error/shape.js";
import { consumeSettledHostCall, resolveSandboxValue } from "./promise.js";
import type { Budget } from "./budget.js";

const activeCancellation = new AsyncLocalStorage<{ signal?: AbortSignal; host: boolean }>();
const sandboxPromises = new WeakSet<SandboxPromise>();
const cancelableOutcomes = new WeakMap<
  SandboxPromise,
  WeakMap<AbortSignal, Promise<SandboxValue>>
>();

export function withCancellationSignal<T>(signal: AbortSignal | undefined, task: () => T): T {
  return activeCancellation.run({ signal, host: false }, task);
}

export function invokeCancelableClosure(
  closure: SandboxClosure,
  operation: SandboxClosure["call"],
  args: readonly SandboxValue[],
  context?: SandboxCallContext,
  construct = false
): SandboxValue | Promise<SandboxValue> {
  assertPromiseExecutionAllowed();
  const active = activeCancellation.getStore();
  if (active === undefined) return operation(args, context);
  if (closure.sandbox === true) {
    return activeCancellation.run({ signal: active.signal, host: false }, () =>
      operation(args, context)
    );
  }
  const signal = active.signal;
  const managed = signal !== undefined && closure.cancellationSignal === signal;
  if (signal?.aborted && !managed) {
    if (!construct && closure.async === true)
      return createRejectedSandboxPromise(readAbortReason(signal));
    throw readAbortReason(signal);
  }
  return activeCancellation.run({ signal, host: true }, () => {
    const result = operation(args, context);
    if (signal === undefined || managed) return result;
    if (isPromiseLike(result))
      return awaitWithSignal(result, signal).then((value) => {
        registerCancelablePromises(value, signal);
        return value;
      });
    registerCancelablePromises(result, signal);
    return result;
  });
}

export function wrapCancelableBindings(
  bindings: Record<string, SandboxValue>,
  signal?: AbortSignal
): Record<string, SandboxValue> {
  if (signal !== undefined) registerCancelablePromises(bindings, signal);
  return bindings;
}

export function registerPromiseCancellation(promise: SandboxPromise): void {
  const active = activeCancellation.getStore();
  if (active?.host === false) sandboxPromises.add(promise);
  else if (active?.signal !== undefined) managePromiseCancellation(promise, active.signal);
}

export function readPromiseCancellation(
  promise: SandboxPromise,
  original: Promise<SandboxValue>
): Promise<SandboxValue> {
  const signal = activeCancellation.getStore()?.signal;
  return signal === undefined
    ? original
    : (cancelableOutcomes.get(promise)?.get(signal) ?? original);
}

function managePromiseCancellation(promise: SandboxPromise, signal: AbortSignal): void {
  let outcomes = cancelableOutcomes.get(promise);
  if (outcomes?.has(signal)) return;
  if (outcomes === undefined) {
    outcomes = new WeakMap();
    cancelableOutcomes.set(promise, outcomes);
  }
  const outcome = awaitWithSignal(promise.promise, signal);
  outcomes.set(signal, outcome);
  trackSandboxPromise(promise, outcome);
}

function registerCancelablePromises(value: SandboxValue, signal: AbortSignal): void {
  const seen = new WeakSet<object>();
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) continue;
    seen.add(current);
    const prototype = getSandboxPrototype(current);
    if (prototype !== null) pending.push(prototype as SandboxValue);
    if (isSandboxPromise(current)) {
      if (!sandboxPromises.has(current)) managePromiseCancellation(current, signal);
      continue;
    }
    if (isSandboxClosure(current)) {
      if (current.properties !== undefined) pending.push(current.properties);
    } else if (isSandboxMap(current)) {
      for (const [key, entry] of current.entries) pending.push(key, entry);
    } else if (isSandboxSet(current)) {
      for (const entry of current.values) pending.push(entry);
    } else {
      if (isSandboxCollectionIterator(current)) pending.push(collectionIteratorState(current).collection);
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(current))) {
        if ("value" in descriptor) pending.push(descriptor.value as SandboxValue);
      }
    }
  }
}

export function awaitSandboxValue(
  value: SandboxValue,
  signal?: AbortSignal,
  budget?: Budget
): Promise<SandboxValue> {
  let resolved: Promise<SandboxValue>;
  if (isSandboxPromise(value)) {
    observeSandboxPromise(value);
    const outcome =
      signal === undefined
        ? value.promise
        : (cancelableOutcomes.get(value)?.get(signal) ?? value.promise);
    resolved = new Promise((resolve, reject) => {
      const detach = onFatalPromiseRejection(reject);
      const complete = (state: "fulfilled" | "rejected", result: unknown) => {
        detach?.();
        try {
          consumeSettledHostCall(value);
          if (state === "fulfilled") resolve(result as SandboxValue);
          else reject(result);
        } catch (error) {
          reject(error);
        }
      };
      outcome.then(
        (result) => complete("fulfilled", result),
        (reason: unknown) => complete("rejected", reason)
      );
    });
  } else {
    resolved = resolveSandboxValue(value, { budget });
  }
  const pending =
    isSandboxPromise(value) &&
    (value.synchronousPrefix !== undefined ||
      (signal !== undefined && cancelableOutcomes.get(value)?.has(signal)))
      ? resolved
      : awaitWithSignal(resolved, signal);
  return isSandboxPromise(value) ? pending : interruptOnFatalPromiseRejection(pending);
}

function awaitWithSignal<T>(promise: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return Promise.resolve(promise);
  if (signal.aborted) {
    void Promise.resolve(promise).catch(() => undefined);
    return Promise.reject(readAbortReason(signal));
  }

  return new Promise((resolve, reject) => {
    let listenerActive = true;
    let settled = false;
    const onAbort = () => {
      cleanup();
      queueMicrotask(() => {
        settle(() => reject(readAbortReason(signal)));
      });
    };
    const cleanup = () => {
      if (!listenerActive) {
        return;
      }

      listenerActive = false;
      signal.removeEventListener("abort", onAbort);
    };
    const settle = (complete: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      complete();
    };

    signal.addEventListener("abort", onAbort, { once: true });

    Promise.resolve(promise).then(
      (value) => {
        settle(() => resolve(value));
      },
      (reason) => {
        settle(() => reject(reason));
      }
    );
  });
}

function readAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? createAbortError();
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    const error = new DOMException("This operation was aborted", "AbortError");
    replaceErrorStack(error);
    return error;
  }

  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  replaceErrorStack(error);
  return error;
}

function createRejectedSandboxPromise(reason: unknown): ReturnType<typeof createSandboxPromise> {
  const promise = Promise.reject(reason) as Promise<SandboxValue>;
  promise.catch(() => undefined);
  return createSandboxPromise(promise);
}

function isPromiseLike(value: unknown): value is PromiseLike<SandboxValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}

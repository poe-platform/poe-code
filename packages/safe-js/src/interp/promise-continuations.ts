import type { SandboxClosure, SandboxObject, SandboxPromise, SandboxValue } from "./values.js";

export type ThenableContinuation = {
  source: SandboxValue;
  owner: SandboxPromise | undefined;
  settlement: {state: "fulfilled" | "rejected"; value: SandboxValue} | undefined;
  completed: boolean;
  invocationPending: boolean;
};
export const thenableContinuations = new WeakMap<SandboxPromise, ThenableContinuation>();
export const thenableStates = new WeakMap<object, ThenableContinuation>();
export const thenableResolvers = new WeakMap<SandboxClosure, {
  continuation: ThenableContinuation; action: "fulfilled" | "rejected"
}>();

export type PromiseCapabilityExecutorState = {resolve: SandboxValue; reject: SandboxValue};
export const promiseCapabilityExecutors = new WeakMap<SandboxClosure, PromiseCapabilityExecutorState>();

export type PromiseAggregateState = {
  method: "all" | "allSettled" | "race" | "any";
  capability: {promise: SandboxValue; resolve: SandboxClosure; reject: SandboxClosure};
  values: SandboxValue[];
  remaining: number;
  size: number;
  iteration: "active" | "complete" | "abrupt";
};

export type PromiseAggregateEntry = {
  aggregate: PromiseAggregateState;
  index: number;
  called: boolean;
};

export const promiseAggregateHandlers = new WeakMap<SandboxClosure, {
  entry: PromiseAggregateEntry; action: "fulfilled" | "rejected"
}>();
export const promiseAggregateStates = new WeakMap<object, PromiseAggregateState>();
export const promiseAggregateEntries = new WeakMap<object, PromiseAggregateEntry>();

export type PromiseAdoptionBridge = {
  source: SandboxPromise;
  owner: SandboxPromise | undefined;
  settled: boolean;
  promise: Promise<SandboxValue>;
  resolve: SandboxClosure;
  reject: SandboxClosure;
  rejectNative: (reason: unknown) => void;
};

export const promiseAdoptions = new WeakMap<SandboxPromise, SandboxObject>();
export const promiseAdoptionBridges = new WeakMap<object, PromiseAdoptionBridge>();
export const promiseAdoptionResolvers = new WeakMap<SandboxClosure, {
  bridge: SandboxObject; action: "fulfilled" | "rejected"
}>();

export type PromiseContinuation =
  | { kind: "capability"; state: {promise: SandboxPromise; settled: boolean};
      resolution?: {status: "fulfilled" | "rejected"; value: SandboxValue} }
  | { kind: "reaction"; phase: "waiting" | "running"; source: SandboxPromise; onFulfilled: SandboxValue; onRejected: SandboxValue;
      aggregate?: SandboxPromise;
      capability?: {promise: SandboxPromise; resolve: SandboxClosure; reject: SandboxClosure} };

export const promiseContinuations = new WeakMap<SandboxPromise, PromiseContinuation>();
export const promiseReactionResults = new WeakMap<SandboxPromise, Set<SandboxPromise>>();
export const promiseProducers = new WeakMap<SandboxPromise, Set<SandboxPromise>>();

export function linkPromiseAggregateProducer(producer: SandboxPromise, aggregate: SandboxPromise): void {
  const continuation = promiseContinuations.get(producer);
  if (continuation?.kind !== "reaction") return;
  continuation.aggregate = aggregate;
  let producers = promiseProducers.get(aggregate);
  if (producers === undefined) promiseProducers.set(aggregate, producers = new Set());
  producers.add(producer);
}

export function trackPromiseContinuation(promise: SandboxPromise, continuation: PromiseContinuation): void {
  promiseContinuations.set(promise, continuation);
  if (continuation.kind === "reaction") {
    let results = promiseReactionResults.get(continuation.source);
    if (results === undefined) promiseReactionResults.set(continuation.source, results = new Set());
    results.add(promise);
    if (continuation.capability !== undefined) {
      let producers = promiseProducers.get(continuation.capability.promise);
      if (producers === undefined) promiseProducers.set(continuation.capability.promise, producers = new Set());
      producers.add(promise);
    }
  }
  const release = () => {
    promiseContinuations.delete(promise);
    if (continuation.kind === "capability") delete continuation.resolution;
    else {
      const results = promiseReactionResults.get(continuation.source);
      results?.delete(promise);
      if (results?.size === 0) promiseReactionResults.delete(continuation.source);
      if (continuation.capability !== undefined) {
        const producers = promiseProducers.get(continuation.capability.promise);
        producers?.delete(promise);
        if (producers?.size === 0) promiseProducers.delete(continuation.capability.promise);
      }
      if (continuation.aggregate !== undefined) {
        const producers = promiseProducers.get(continuation.aggregate);
        producers?.delete(promise);
        if (producers?.size === 0) promiseProducers.delete(continuation.aggregate);
      }
    }
  };
  promise.promise.then(release, release);
}

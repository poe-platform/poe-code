import type { SandboxPromise } from "./values.js";

export type AtomicWaitState = {
  view: Int32Array | BigInt64Array;
  index: number;
  timeout: number;
  startedAt?: number;
  order: number;
};

export const atomicWaitStates = new WeakMap<SandboxPromise, AtomicWaitState>();
export const atomicWaitOrders = new WeakMap<object, number>();

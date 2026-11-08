import type { SandboxClosure, SandboxPromise } from "./values.js";

export const promiseResolvingFunctions = new WeakMap<SandboxClosure, {
  promise: SandboxPromise;
  settled: boolean;
}>();

export const promiseResolverActions = new WeakMap<SandboxClosure, "fulfilled" | "rejected">();

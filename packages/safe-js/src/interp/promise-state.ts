import type { SandboxPromise, SandboxValue } from "./values.js";

export type PromiseState = { status: "pending" } | { status: "fulfilled" | "rejected"; value: SandboxValue };

export const promiseStates = new WeakMap<SandboxPromise, PromiseState>();
export const importedPromises = new WeakSet<SandboxPromise>();
export const importedPromiseSnapshots = new WeakMap<SandboxPromise,
  { ok: true; state: { status: "fulfilled" | "rejected"; value: SandboxValue } } |
  { ok: false; error: unknown }
>();

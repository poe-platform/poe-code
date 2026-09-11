import type { SandboxValue } from "./values.js";

export type IteratorWrapperState = { iterator: SandboxValue; next: SandboxValue };
export const iteratorWrapperStates = new WeakMap<object, IteratorWrapperState>();

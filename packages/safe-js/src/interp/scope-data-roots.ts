import type { InterpreterValue } from "./interpreter.js";

// Accounting-only snapshots: never guest objects or serialized frame cells.
export const scopeDataRoots = new WeakMap<object,
  { readonly value: InterpreterValue } | { readonly values: readonly InterpreterValue[] }
>();

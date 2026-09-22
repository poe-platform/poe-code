import type { InterpreterValue } from "./interpreter.js";

// Accounting-only snapshots: never guest objects or serialized frame cells.
type ScopeDataRoot =
  { readonly value: InterpreterValue } | { readonly values: readonly InterpreterValue[] };
const records = new WeakMap<object, ScopeDataRoot>();
const nativeGet: typeof records.get = WeakMap.prototype.get.bind(records);
const nativeSet: typeof records.set = WeakMap.prototype.set.bind(records);

// Later native hooks must not receive the registry or its accounting records.
// Discard WeakMap.set's return value so registration cannot reveal the raw map.
export const scopeDataRoots = Object.freeze({
  get: nativeGet,
  set(root: object, data: ScopeDataRoot): void {
    nativeSet(root, data);
  }
});

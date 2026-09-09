import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { UnhashableRuntimeValueError } from "./runtime-hash.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import type { ItemMutation } from "./runtime-mutation.js";
import type { DictionaryValue, RuntimeValue } from "./runtime-values.js";

/** Internal fault carrying guest arguments, not a rendered guest exception.
 * KeyError formatting must apply repr later; raising must not convert the key.
 * The host message is diagnostic only, never Python str(KeyError).
 */
export class PythonKeyError extends PythonRuntimeError {
  readonly args: readonly [RuntimeValue];

  constructor(key: RuntimeValue, meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    super("KeyError", "dictionary key not found");
    this.args = Object.freeze([key]);
  }
}

export function runtimeDictionaryAccess(object: DictionaryValue, key: RuntimeValue, operation: "get", meter: ExecutionMeter): RuntimeValue;
export function runtimeDictionaryAccess(object: DictionaryValue, key: RuntimeValue, operation: "lookup", meter: ExecutionMeter): { readonly value: RuntimeValue } | undefined;
export function runtimeDictionaryAccess(object: DictionaryValue, key: RuntimeValue, operation: "pop", meter: ExecutionMeter): { readonly value: RuntimeValue } | undefined;
export function runtimeDictionaryAccess(object: DictionaryValue, key: RuntimeValue, operation: { readonly kind: "setdefault"; readonly value: RuntimeValue }, meter: ExecutionMeter): RuntimeValue;
export function runtimeDictionaryAccess(object: DictionaryValue, key: RuntimeValue, operation: "contains", meter: ExecutionMeter): boolean;
export function runtimeDictionaryAccess(object: DictionaryValue, key: RuntimeValue, operation: ItemMutation, meter: ExecutionMeter): void;
/** Exact dict key operations share error context and never preflight a lookup:
 * each performs one hash, except pop's no-hash empty-dictionary fast path.
 * Slice objects remain keys; no sequence-index conversion occurs here.
 */
export function runtimeDictionaryAccess(object: DictionaryValue, key: RuntimeValue, operation: "get" | "lookup" | "pop" | "contains" | ItemMutation | { readonly kind: "setdefault"; readonly value: RuntimeValue }, meter: ExecutionMeter): RuntimeValue | { readonly value: RuntimeValue } | boolean | void {
  meter.checkpoint();
  try {
    if (operation === "contains") return object.items.containsKey(key);
    if (operation === "lookup") return object.items.lookup(key);
    if (operation === "pop") return object.items.pop(key);
    if (operation === "get") {
      const found = object.items.lookup(key);
      if (found !== undefined) return found.value;
    } else if (operation.kind === "setdefault") return object.items.setdefault(key, operation.value);
    else if (operation.kind === "set") {
      object.items.set(key, operation.value);
      return;
    } else if (object.items.delete(key)) return;
    throw new PythonKeyError(key, meter);
  } catch (error) {
    if (!(error instanceof UnhashableRuntimeValueError) && !(error instanceof RuntimeHashError)) throw error;
    const type = error instanceof RuntimeHashError ? error.keyType : key.kind;
    throw new PythonRuntimeError("TypeError", `cannot use '${type}' as a dict key (${error.message})`);
  }
}

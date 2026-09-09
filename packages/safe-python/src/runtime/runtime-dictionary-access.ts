import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { UnhashableRuntimeValueError } from "./runtime-hash.js";
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
export function runtimeDictionaryAccess(object: DictionaryValue, key: RuntimeValue, operation: "contains", meter: ExecutionMeter): boolean;
export function runtimeDictionaryAccess(object: DictionaryValue, key: RuntimeValue, operation: ItemMutation, meter: ExecutionMeter): void;
/** Exact dict key operations share error context and never preflight a lookup:
 * each performs one hash, including absent/unhashable keys in empty dictionaries.
 * Slice objects remain keys; no sequence-index conversion occurs here.
 */
export function runtimeDictionaryAccess(object: DictionaryValue, key: RuntimeValue, operation: "get" | "contains" | ItemMutation, meter: ExecutionMeter): RuntimeValue | boolean | void {
  meter.checkpoint();
  try {
    if (operation === "contains") return object.items.containsKey(key);
    if (operation === "get") {
      const found = object.items.lookup(key);
      if (found !== undefined) return found.value;
    } else if (operation.kind === "set") {
      object.items.set(key, operation.value);
      return;
    } else if (object.items.delete(key)) return;
    throw new PythonKeyError(key, meter);
  } catch (error) {
    if (!(error instanceof UnhashableRuntimeValueError)) throw error;
    throw new PythonRuntimeError("TypeError", `cannot use '${key.kind}' as a dict key (${error.message})`);
  }
}

import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { updateRuntimeSet } from "./runtime-set.js";
import type { DictionaryValue, FrozenSetValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact construction; subclass creation and type registration are separate.
 * Build privately, then seal before publication. Exact frozen inputs are
 * idempotent only after argument validation. Mutable inputs remain independent. */
export function constructRuntimeFrozenSet(positional: readonly RuntimeValue[], keywords: DictionaryValue, values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter): FrozenSetValue {
  meter.checkpoint();
  if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "frozenset() takes no keyword arguments");
  if (positional.length > 1) throw new PythonRuntimeError("TypeError", `frozenset expected at most 1 argument, got ${positional.length}`);
  const source = positional[0];
  if (source?.kind === "frozenset") return source;
  const builder = values.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  if (source !== undefined) updateRuntimeSet(builder, source, values, meter);
  return values.frozenSet(builder.items);
}

import { ConstantIterator } from "./constant-iterator.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeRangeIterator } from "./runtime-range-iterator.js";
import type { RuntimeValue } from "./runtime-values.js";
import type { ConstantValues } from "./constant-values.js";
import { PythonRuntimeError } from "./error.js";
import { iterateRuntimeDictionaryView } from "./runtime-dictionary-view.js";
import type { CompletionIterator } from "./iterator-completion.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import { lengthHint } from "./length-hint.js";

/** Acquire host iteration for exact builtin runtime values. Prepared iterator
 * records preserve their cursor identity; lists use live storage, not snapshots.
 * Range payloads are wrapped only when pulled. Optional guest type-level slots
 * are adapted only for non-builtin inputs, preserving exhaustion metadata.
 * List-style collectors request a source hint after acquisition; it is checked
 * for protocol effects without trusting it for allocation or iteration count.
 * Iterator type objects and full object wiring remain external. The values
 * factory and storage must use this execution's meter.
 */
export function runtimeIterate(value: RuntimeValue, values: ConstantValues, meter: ExecutionMeter, protocol?: IterationContext<RuntimeValue>, notIterable?: (typeName: string) => never, hint = false): CompletionIterator<RuntimeValue> {
  meter.checkpoint();
  switch (value.kind) {
    case "set": case "frozenset":
      meter.checkpoint(1, 32);
      return value.items.iterate(key => key, "set");
    case "dict_keys": case "dict_values": case "dict_items": return iterateRuntimeDictionaryView(value, values, meter);
    case "iterator": return value.value;
    case "list": return value.items.iterate();
    case "dict": case "mappingproxy":
      meter.checkpoint(1, 32);
      return (value.kind === "dict" ? value : value.value).items.iterate(key => key);
    case "range": return createRuntimeRangeIterator(value.value, false, values, meter);
    case "tuple": case "str": case "bytes": return new ConstantIterator<RuntimeValue>(value, values, meter);
    default: {
      if (protocol !== undefined) {
        const iterator = new ProtocolIterator(value, protocol, meter, notIterable);
        if (hint && protocol.hints !== undefined) lengthHint(value, protocol.hints, meter, 8n);
        return iterator;
      }
      const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
      if (notIterable !== undefined) return notIterable(type);
      throw new PythonRuntimeError("TypeError", `'${type}' object is not iterable`);
    }
  }
}

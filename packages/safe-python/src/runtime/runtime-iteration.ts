import { ConstantIterator } from "./constant-iterator.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { RangeIterator } from "./range-iterator.js";
import type { RuntimeValue } from "./runtime-values.js";
import type { ConstantValues } from "./constant-values.js";
import { PythonRuntimeError } from "./error.js";

/** Acquire host iteration for exact builtin runtime values. Prepared iterator
 * records preserve their cursor identity; lists use live storage, not snapshots.
 * Range payloads are wrapped only when pulled. Guest special-method dispatch,
 * iterator type objects and StopIteration translation belong to the object
 * runtime. The values factory and storage must use this execution's meter.
 */
export function runtimeIterate(value: RuntimeValue, values: ConstantValues, meter: ExecutionMeter): Iterator<RuntimeValue> {
  meter.checkpoint();
  switch (value.kind) {
    case "getset_descriptor": throw new PythonRuntimeError("TypeError", "'getset_descriptor' object is not iterable");
    case "type": throw new PythonRuntimeError("TypeError", "'type' object is not iterable");
    case "cell": throw new PythonRuntimeError("TypeError", "'cell' object is not iterable");
    case "function": throw new PythonRuntimeError("TypeError", "'function' object is not iterable");
    case "method": throw new PythonRuntimeError("TypeError", "'method' object is not iterable");
    case "builtin_function_or_method": throw new PythonRuntimeError("TypeError", "'builtin_function_or_method' object is not iterable");
    case "iterator": return value.value;
    case "list": return value.items.iterate();
    case "dict":
      meter.checkpoint(1, 32);
      return value.items.iterate(key => key);
    case "range": {
      meter.checkpoint(1, 32);
      const source = new RangeIterator(value.value, false, meter);
      return {
        next(): IteratorResult<RuntimeValue> {
          meter.checkpoint(1, 16);
          const item = source.next();
          return item.done ? { done: true, value: undefined } : { done: false, value: values.integer(item.value) };
        }
      };
    }
    default: return new ConstantIterator<RuntimeValue>(value, values, meter);
  }
}

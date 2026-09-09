import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import { collectIterator } from "./iterator-collection.js";
import { runtimeSequenceIterator } from "./runtime-sequence-iterator.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Consume generic iterables before member validation; an iterator failure
 * takes precedence over an invalid element already collected. */
export function createRuntimeBytesJoinMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, values: RuntimeValues, meter: ExecutionMeter, iterate?: ExpressionContext<RuntimeValue>["iterate"]): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "join",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "bytes.join() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `bytes.join() takes exactly one argument (${positional.length} given)`);
      const source = positional[0];
      let items: readonly RuntimeValue[];
      if (source.kind === "tuple") items = source.items;
      else if (source.kind === "list") items = source.items.snapshot();
      else {
        const iterator = runtimeSequenceIterator(source, values, meter, "can only join an iterable", iterate);
        items = collectIterator(iterator, meter);
      }
      if (items.length === 0) return values.bytes(new Uint8Array());
      if (items.length === 1 && items[0].kind === "bytes") return items[0];
      meter.checkpoint(1, 32 + 8 * items.length);
      const parts: ImmutableBytes[] = new Array(items.length);
      for (let index = 0; index < items.length; index++) {
        meter.checkpoint(); const item = items[index];
        if (item.kind !== "bytes") {
          const type = item.kind === "none" ? "NoneType" : item.kind === "not-implemented" ? "NotImplementedType" : item.kind;
          throw new PythonRuntimeError("TypeError", `sequence item ${index}: expected a bytes-like object, ${type} found`);
        }
        parts[index] = item.value;
      }
      const result = receiver.value.join(parts, meter);
      return values.bytes(result, result.length === 0 ? "canonical" : "fresh");
    }
  });
}

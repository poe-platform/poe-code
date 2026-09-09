import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { RangeIterator } from "./range-iterator.js";
import { constructReversed, type ReversedConstructionContext } from "./reversed-construction.js";
import { iterateRuntimeDictionaryView } from "./runtime-dictionary-view.js";
import { runtimeIndex } from "./runtime-index.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Register explicitly in the builtin namespace. Exact builtins use their own
 * cursors; other objects may supply type-level methods or indexed fallback via
 * the explicit protocol context. Values, storage and callbacks share one meter.
 * Custom method results need not be iterators. No host properties are inspected.
 */
export function createReversedBuiltin(values: RuntimeValues, meter: ExecutionMeter, context?: Omit<ReversedConstructionContext<RuntimeValue>, "wrap">): BuiltinFunctionValue {
  meter.checkpoint(1, 384);
  const protocol: ReversedConstructionContext<RuntimeValue> = {
    lookupReversed(source) {
      meter.checkpoint(1, 64);
      switch (source.kind) {
        case "list": return () => values.iterator(source.items.reversed());
        case "dict": return () => values.iterator(source.items.reversed(key => key));
        case "mappingproxy": return () => values.iterator(source.value.items.reversed(key => key));
        case "dict_keys": case "dict_values": case "dict_items":
          return () => values.iterator(iterateRuntimeDictionaryView(source, values, meter, true));
        case "range": return () => {
          meter.checkpoint(1, 64);
          const cursor = new RangeIterator(source.value, true, meter);
          return values.iterator({
            next() {
              meter.checkpoint(1, 16);
              const item = cursor.next();
              return item.done ? { done: true, value: undefined } : { done: false, value: values.integer(item.value) };
            }
          });
        };
        case "tuple": case "str": case "bytes": return undefined;
        default: return context?.lookupReversed(source);
      }
    },
    hasSequenceItem: source => source.kind === "tuple" || source.kind === "str" || source.kind === "bytes" || (context?.hasSequenceItem(source) ?? false),
    length(source) {
      if (source.kind === "tuple") return BigInt(source.items.length);
      if (source.kind === "str" || source.kind === "bytes") return BigInt(source.value.length);
      if (context) return context.length(source);
      throw new Error("reverse sequence length policy is unavailable");
    },
    getItem(source, index) {
      if (source.kind === "tuple" || source.kind === "str" || source.kind === "bytes") return runtimeIndex(source, values.integer(index), values, meter);
      if (context) return context.getItem(source, index);
      throw new Error("reverse sequence item policy is unavailable");
    },
    isIndexError: error => (error instanceof PythonRuntimeError && error.name === "IndexError") || (context?.isIndexError(error) ?? false),
    isStopIteration: error => (error instanceof PythonRuntimeError && error.name === "StopIteration") || (context?.isStopIteration(error) ?? false),
    typeName: source => context ? context.typeName(source) : source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind,
    wrap: values.iterator.bind(values)
  };
  return values.builtinFunction({
    name: "reversed",
    invoke(positional, keywords, meter) {
      return constructReversed(positional, keywords.items, protocol, meter);
    }
  });
}

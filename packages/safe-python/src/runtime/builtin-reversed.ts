import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeRangeIterator } from "./runtime-range-iterator.js";
import { constructReversed, type ReversedConstructionContext } from "./reversed-construction.js";
import { iterateRuntimeDictionaryView } from "./runtime-dictionary-view.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeLength } from "./runtime-length.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Register explicitly in the builtin namespace. Exact builtins use their own
 * cursors; other objects may supply type-level methods or indexed fallback via
 * explicit or invocation protocols. Values, storage and callbacks share one meter.
 * Custom method results need not be iterators. No host properties are inspected.
 */
export function createReversedBuiltin(values: RuntimeValues, meter: ExecutionMeter, context?: Omit<ReversedConstructionContext<RuntimeValue>, "wrap">): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "reversed", invoke(positional, keywords, meter, invocation) {
    meter.checkpoint(0, 384);
    const protocol: ReversedConstructionContext<RuntimeValue> = {
      lookupReversed(source) {
        meter.checkpoint(1, 64);
        switch (source.kind) {
          case "list": return () => values.iterator(source.items.reversed());
          case "dict": return () => values.iterator(source.items.reversed(key => key));
          case "mappingproxy": return () => {
            if (source.owner === undefined) return values.iterator(source.value.items.reversed(key => key));
            if (invocation?.attribute === undefined) throw Error("mapping proxy reversal requires attribute access");
            return invocation.call(invocation.attribute(source.owner, "__reversed__"), []);
          };
          case "dict_keys": case "dict_values": case "dict_items":
            return () => values.iterator(iterateRuntimeDictionaryView(source, values, meter, true));
          case "range": return () => values.iterator(createRuntimeRangeIterator(source.value, true, values, meter));
          case "tuple": case "str": case "bytes": return undefined;
        }
        if (context !== undefined) return context.lookupReversed(source);
        const method = invocation?.lookupSpecial?.(source, "__reversed__"); meter.checkpoint();
        if (method === undefined) return undefined;
        if (method.kind === "none") return null;
        return () => { meter.checkpoint(0, 8); return invocation!.call(method, []); };
      },
      hasSequenceItem: source => source.kind === "tuple" || source.kind === "str" || source.kind === "bytes" || (context !== undefined ? context.hasSequenceItem(source) : invocation?.hasSpecial?.(source, "__getitem__") ?? false),
      length(source) {
        if (source.kind === "tuple") return BigInt(source.items.length);
        if (source.kind === "str" || source.kind === "bytes") return BigInt(source.value.length);
        if (context) return context.length(source);
        return BigInt(runtimeLength(source, meter, undefined, invocation));
      },
      getItem(source, index) {
        if (source.kind === "tuple" || source.kind === "str" || source.kind === "bytes") return runtimeIndex(source, values.integer(index), values, meter);
        if (context) return context.getItem(source, index);
        const method = invocation?.lookupSpecial?.(source, "__getitem__"); meter.checkpoint();
        if (method === undefined) throw new PythonRuntimeError("TypeError", `'${invocation?.typeName?.(source) ?? source.kind}' object is not subscriptable`);
        meter.checkpoint(0, 8);
        return invocation!.call(method, [values.integer(index)]);
      },
      isIndexError: error => (error instanceof PythonRuntimeError && error.name === "IndexError") || (context !== undefined ? context.isIndexError(error) : invocation?.iteration?.isIndexError(error) ?? false),
      isStopIteration: error => (error instanceof PythonRuntimeError && error.name === "StopIteration") || (context !== undefined ? context.isStopIteration(error) : invocation?.isStopIteration(error) ?? false),
      typeName: source => context ? context.typeName(source) : invocation?.typeName?.(source) ?? (source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind),
      wrap: values.iterator.bind(values)
    };
    return constructReversed(positional, keywords.items, protocol, meter);
  } });
}

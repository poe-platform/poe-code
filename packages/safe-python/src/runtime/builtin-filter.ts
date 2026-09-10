import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { FilterIterator, type FilterIterationContext } from "./filter-iterator.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface FilterBuiltinContext extends Partial<Pick<FilterIterationContext<RuntimeValue>, "call" | "isStopIteration">> {
  iteration?: IterationContext<RuntimeValue>;
  /** Exact builtin bool object from this execution's native type registry. */
  boolType?: RuntimeValue;
  truth?(value: RuntimeValue): boolean;
}

/** Positional-only constructor binding with eager acquisition and lazy filtering.
 * Predicates are not inspected for callability at construction. The existing
 * kernel owns truth conversion, member identity and exhaustion forwarding;
 * native type registration/subclass construction remain external. */
export function createFilterBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: FilterBuiltinContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 160);
  return values.builtinFunction({
    name: "filter",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "filter() takes no keyword arguments");
      if (positional.length !== 2) throw new PythonRuntimeError("TypeError", `filter expected 2 arguments, got ${positional.length}`);
      const source = runtimeIterate(positional[1], values, meter, context.iteration);
      meter.checkpoint(0, 192);
      const filtering: FilterIterationContext<RuntimeValue> = {
        isTruthPredicate: predicate => predicate.kind === "none" || predicate === context.boolType,
        call(predicate, value) {
          if (context.call !== undefined) return context.call(predicate, value);
          if (invocation !== undefined) { meter.checkpoint(0, 8); return invocation.call(predicate, [value]); }
          throw new Error("filter requires an execution call capability");
        },
        truth(value) {
          if (context.truth !== undefined) return context.truth(value);
          if (invocation?.truth !== undefined) return invocation.truth(value);
          return runtimeTruth(value, meter);
        },
        isStopIteration(error) {
          if (context.isStopIteration !== undefined) return context.isStopIteration(error);
          if (invocation !== undefined) return invocation.isStopIteration(error);
          return error instanceof PythonRuntimeError && error.name === "StopIteration";
        }
      };
      return values.iterator(new FilterIterator(positional[0], source, filtering, meter));
    }
  });
}

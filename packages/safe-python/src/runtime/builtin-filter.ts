import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { FilterIterator, type FilterIterationContext } from "./filter-iterator.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface FilterBuiltinContext extends Pick<FilterIterationContext<RuntimeValue>, "call" | "isStopIteration"> {
  iteration?: IterationContext<RuntimeValue>;
  /** Exact builtin bool object from this execution's native type registry. */
  boolType?: RuntimeValue;
  truth?(value: RuntimeValue): boolean;
}

/** Positional-only constructor binding with eager acquisition and lazy filtering.
 * Predicates are not inspected for callability at construction. The existing
 * kernel owns truth conversion, member identity and exhaustion forwarding;
 * native type registration/subclass construction remain external. */
export function createFilterBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: FilterBuiltinContext): BuiltinFunctionValue {
  meter.checkpoint(1, 160);
  const filtering: FilterIterationContext<RuntimeValue> = {
    isTruthPredicate: predicate => predicate.kind === "none" || predicate === context.boolType,
    call: context.call.bind(context),
    truth: context.truth?.bind(context) ?? ((value: RuntimeValue) => runtimeTruth(value, meter)),
    isStopIteration: context.isStopIteration.bind(context)
  };
  return values.builtinFunction({
    name: "filter",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "filter() takes no keyword arguments");
      if (positional.length !== 2) throw new PythonRuntimeError("TypeError", `filter expected 2 arguments, got ${positional.length}`);
      const source = runtimeIterate(positional[1], values, meter, context.iteration);
      return values.iterator(new FilterIterator(positional[0], source, filtering, meter));
    }
  });
}

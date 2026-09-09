import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

export type RuntimeSearchEqualityContext = Partial<Pick<ExpressionContext<RuntimeValue>, "compare" | "truth">>;

/** Adapt rich equality and truth to native search kernels. Identity shortcuts
 * belong to the owning collection; guest callbacks and construction share the
 * execution meter. Neither comparison results nor callback errors are coerced
 * using host JavaScript truthiness or exception classification. */
export function createRuntimeSearchEquality(values: RuntimeValues, meter: ExecutionMeter, context: RuntimeSearchEqualityContext = {}): (left: RuntimeValue, right: RuntimeValue) => boolean {
  meter.checkpoint(0, 64);
  return (left, right) => {
    const result = context.compare === undefined ? runtimeComparison("==", left, right, values, meter) : context.compare("==", left, right);
    meter.checkpoint();
    const matches = context.truth === undefined ? runtimeTruth(result, meter) : context.truth(result);
    meter.checkpoint();
    return matches;
  };
}

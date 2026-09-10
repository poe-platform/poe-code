import { dispatchRichComparison, type RichComparisonDispatch } from "./comparison-dispatch.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComparison, type RuntimeComparisonContext } from "./runtime-comparison.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimeRichComparisonContext {
  /** Prepared for this operand pair/operator, with reflected operands/operator
   * already swapped. Use this execution's NotImplemented singleton. */
  slots: RichComparisonDispatch<RuntimeValue>;
  typeName?(value: RuntimeValue): string;
}

/** Rich comparison returns guest objects, not necessarily booleans. Identity
 * equality fallback happens only after both slots decline, including comparisons
 * of an object with itself. Identity/membership operators are separate paths. */
export function runtimeRichComparison(operator: string, left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context?: RuntimeRichComparisonContext, members?: RuntimeComparisonContext): RuntimeValue {
  meter.checkpoint();
  if (operator !== "<" && operator !== ">" && operator !== "<=" && operator !== ">=" && operator !== "==" && operator !== "!=") throw new Error(`invalid rich comparison operator: ${operator}`);
  if (context === undefined) return runtimeComparison(operator, left, right, values, meter, 1000, members);
  const result = dispatchRichComparison(context.slots, meter);
  meter.checkpoint();
  if (result !== values.notImplemented) return result;
  if (operator === "==" || operator === "!=") return values.boolean(operator === "==" ? left === right : left !== right);
  meter.checkpoint(0, 96);
  const names = [left, right].map(value => diagnosticTypeName(context.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind), meter, 100));
  throw new PythonRuntimeError("TypeError", `'${operator}' not supported between instances of '${names[0]}' and '${names[1]}'`);
}

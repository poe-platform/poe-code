import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";
import { isRuntimeMethodDecoratorSubclass } from "./runtime-method-decorator.js";

export interface CallabilityContext {
  /** Inspect type-level call-slot presence without descriptor lookup or calling
   * the object. A class defining __call__ = None still has a call slot. */
  callable(value: RuntimeValue): boolean;
}

/** Shared classification for actual calls and callable(). Slot presence does
 * not establish that invocation will succeed. Native callable families bypass
 * guest inspection; the context owns remaining guest type classification. */
export function runtimeCallable(value: RuntimeValue, meter: ExecutionMeter, context?: CallabilityContext): boolean {
  meter.checkpoint(0);
  if (value.kind === "staticmethod") return true;
  if (value.kind === "classmethod" && !isRuntimeMethodDecoratorSubclass(value)) return false;
  if (value.kind === "type" && (!value.metaclass.value.nativeSlots.ready || context === undefined)) return true;
  if (value.kind === "function" || value.kind === "builtin_function_or_method" || (value.kind === "method_descriptor" || value.kind === "classmethod_descriptor") || value.kind === "wrapper_descriptor" || value.kind === "method-wrapper" || value.kind === "method") return true;
  const result = context?.callable(value) ?? false;
  meter.checkpoint(0);
  return result;
}

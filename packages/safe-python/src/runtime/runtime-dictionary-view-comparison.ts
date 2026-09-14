import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeContainmentPolicy } from "./runtime-containment-context.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeLength } from "./runtime-length.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeSetPayload } from "./runtime-set-payload.js";
import type { BuiltinInvocationContext, DictionaryViewValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** A view's rich-comparison slot accepts native set subtypes but observes their
 * length, iteration and containment overrides. Keep the guest object intact:
 * its native payload establishes eligibility, not the behavior of its slots. */
export function runtimeDictionaryViewComparison(operator: string, view: DictionaryViewValue, other: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): RuntimeValue {
  meter.checkpoint();
  if (other.kind !== "dict_keys" && other.kind !== "dict_items" && runtimeSetPayload(other) === undefined) return values.notImplemented;
  const leftSize = view.value.items.size;
  const rightSize = runtimeLength(other, meter, undefined, invocation);
  meter.checkpoint();
  if (operator === "==" || operator === "!=") {
    if (BigInt(leftSize) !== BigInt(rightSize)) return values.boolean(operator === "!=");
  } else if ((operator === "<" && leftSize >= rightSize) || (operator === "<=" && leftSize > rightSize)
    || (operator === ">" && leftSize <= rightSize) || (operator === ">=" && leftSize < rightSize)) return values.false;
  const reverse = operator === ">" || operator === ">=";
  const source = reverse ? other : view, target = reverse ? view : other;
  const iterator = runtimeIterate(source, values, meter, invocation?.iteration);
  const containment = invocation === undefined ? undefined : createRuntimeContainmentPolicy(values, meter, invocation)(target);
  for (;;) {
    meter.checkpoint();
    const item = iterator.next();
    meter.checkpoint();
    if (item.done) return values.boolean(operator !== "!=");
    const found = runtimeMembership("in", item.value, target, values, meter, containment, invocation);
    meter.checkpoint();
    if (!found.value) return values.boolean(operator === "!=");
  }
}

import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { iterateRuntimeDictionaryView } from "./runtime-dictionary-view.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeSetPayload } from "./runtime-set-payload.js";
import { runtimeLength } from "./runtime-length.js";
import { createRuntimeContainmentPolicy } from "./runtime-containment-context.js";
import type { BuiltinInvocationContext, DictionaryValue, DictionaryViewValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact view read attributes, using host names supplied by the dispatcher.
 * Only fixed ASCII names match; no host payload fields are discovered. Missing
 * names, readonly-attribute errors and inherited object members belong to the
 * outer dispatcher. Method capabilities retain the original view identity.
 */
export function readRuntimeDictionaryViewAttribute(view: DictionaryViewValue, name: string, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue | undefined {
  meter.checkpoint();
  if (name === "mapping") return values.mappingProxy(view.value, view.owner);
  if (name !== "__reversed__" && (name !== "isdisjoint" || view.kind === "dict_values")) return undefined;
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter, invocation) {
      return callRuntimeDictionaryViewMethod(view, name, positional, keywords, values, meter, invocation);
    }
  });
}

/** Shared native operation for retained bound capabilities and descriptors. */
export function callRuntimeDictionaryViewMethod(view: DictionaryViewValue, name: "__reversed__" | "isdisjoint", positional: readonly RuntimeValue[], keywords: DictionaryValue, values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): RuntimeValue {
  meter.checkpoint();
  if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${view.kind}.${name}() takes no keyword arguments`);
  if (name === "__reversed__") {
    if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `${view.kind}.__reversed__() takes no arguments (${positional.length} given)`);
    return values.iterator(iterateRuntimeDictionaryView(view, values, meter, true));
  }
  if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `${view.kind}.isdisjoint() takes exactly one argument (${positional.length} given)`);
  const other = positional[0];
  if (other === view) return values.boolean(view.value.items.size === 0);
  let source: RuntimeValue = other, target: RuntimeValue = view;
  if ((other.kind === "dict_keys" || other.kind === "dict_items" || runtimeSetPayload(other) !== undefined) && view.value.items.size < runtimeLength(other, meter, undefined, invocation)) {
    source = view; target = other;
  }
  const iterator = runtimeIterate(source, values, meter, invocation?.iteration);
  const containment = invocation === undefined ? undefined : createRuntimeContainmentPolicy(values, meter, invocation)(target);
  while (true) {
    meter.checkpoint();
    const item = iterator.next();
    meter.checkpoint();
    if (item.done) return values.true;
    const found = runtimeMembership("in", item.value, target, values, meter, containment, invocation);
    meter.checkpoint();
    if (found.value) return values.false;
  }
}

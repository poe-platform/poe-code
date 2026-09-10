import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeMutateItem, type ItemMutation } from "./runtime-mutation.js";
import { hasRuntimeInstanceAttributes, type BuiltinInvocationContext, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";

/** Exact containers retain their native kernels. Other subscriptions use live
 * type slots; classes fall back to ordinary __class_getitem__ lookup only when
 * their metaclass has no __getitem__. Keys, slices and results are not coerced. */
export function runtimeGetItem(object: RuntimeValue, key: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext, index?: IntegerIndexContext<RuntimeValue>): RuntimeValue {
  while (object.kind === "mappingproxy") { meter.checkpoint(); object = object.value; }
  if (object.kind === "dict" || object.kind === "list" || object.kind === "tuple" || object.kind === "str" || object.kind === "bytes" || object.kind === "range") return runtimeIndex(object, key, values, meter, index);
  meter.checkpoint();
  const hook = invocation?.lookupSpecial?.(object, "__getitem__"); meter.checkpoint();
  if (hook !== undefined) { const result = invocation!.call(hook, [key]); meter.checkpoint(); return result; }
  if (object.kind === "type") {
    let classHook: RuntimeValue | undefined;
    if (invocation?.attribute !== undefined) {
      try { classHook = invocation.attribute(object, "__class_getitem__"); }
      catch (error) { meter.checkpoint(); if (!runtimeExceptionMatches(error,"AttributeError",invocation)) throw error; }
      meter.checkpoint();
    }
    if (classHook !== undefined && classHook.kind !== "none") { const result = invocation!.call(classHook, [key]); meter.checkpoint(); return result; }
    const name = diagnosticTypeName(object.value.name, meter, 200); meter.checkpoint(0, 128 + 2 * name.length);
    throw new PythonRuntimeError("TypeError", `type '${name}' is not subscriptable`);
  }
  if (hasRuntimeInstanceAttributes(object)) {
    const name = diagnosticTypeName(object.type.value.name, meter, 200); meter.checkpoint(0, 128 + 2 * name.length);
    throw new PythonRuntimeError("TypeError", `'${name}' object is not subscriptable`);
  }
  return runtimeIndex(object, key, values, meter, index);
}

/** A heap type's assignment/deletion slots share one mapping dispatcher. If only
 * the opposite method is present, CPython reports the missing method by name.
 * A successful mutation ignores the guest result and never rolls back effects. */
export function runtimeMutateSubscription(object: RuntimeValue, key: RuntimeValue, change: ItemMutation, values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext, index?: IntegerIndexContext<RuntimeValue>, iterate?: ExpressionContext<RuntimeValue>["iterate"]): void {
  if (object.kind === "dict" || object.kind === "list" || object.kind === "tuple" || object.kind === "str" || object.kind === "bytes" || object.kind === "range" || object.kind === "mappingproxy" || object.kind === "set" || object.kind === "frozenset" || object.kind === "dict_keys" || object.kind === "dict_values" || object.kind === "dict_items") {
    runtimeMutateItem(object, key, change, values, meter, index, iterate); return;
  }
  meter.checkpoint();
  const name = change.kind === "set" ? "__setitem__" : "__delitem__", hook = invocation?.lookupSpecial?.(object, name); meter.checkpoint();
  if (hook !== undefined) { invocation!.call(hook, change.kind === "set" ? [key, change.value] : [key]); meter.checkpoint(); return; }
  const opposite = invocation?.hasSpecial?.(object, change.kind === "set" ? "__delitem__" : "__setitem__"); meter.checkpoint();
  if (opposite) throw new PythonRuntimeError("AttributeError", name);
  if (hasRuntimeInstanceAttributes(object) || object.kind === "type") {
    const type = object.kind === "type" ? object.metaclass : object.type;
    const typeName = diagnosticTypeName(type.value.name, meter, 200), verb = change.kind === "delete" && type.value.hasSequenceTable ? "doesn't" : "does not";
    meter.checkpoint(0, 128 + 2 * typeName.length);
    throw new PythonRuntimeError("TypeError", `'${typeName}' object ${verb} support item ${change.kind === "set" ? "assignment" : "deletion"}`);
  }
  runtimeMutateItem(object, key, change, values, meter, index, iterate);
}

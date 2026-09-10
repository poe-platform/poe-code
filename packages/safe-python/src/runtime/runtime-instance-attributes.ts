import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { readInstanceAttribute, writeInstanceAttribute, deleteInstanceAttribute } from "./instance-attributes.js";
import { resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import { lookupRuntimeSpecialMethod, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import type { AttributeInstanceValue, BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

function missingAttribute(instance: AttributeInstanceValue, name: string, meter: ExecutionMeter, mode: "missing" | "readonly" | "no-dictionary" = "missing"): PythonRuntimeError {
  const type = diagnosticTypeName(instance.type.value.name, meter, 100);
  meter.checkpoint(0, 128 + name.length * 2 + type.length * 2);
  return new PythonRuntimeError("AttributeError", mode === "readonly"
    ? `'${type}' object attribute '${name}' is read-only`
    : `'${type}' object has no attribute '${name}'${mode === "no-dictionary" ? " and no __dict__ for setting new attributes" : ""}`);
}

/** Instance lookup with live descriptor precedence. Supplying invocation enables
 * __getattribute__/__getattr__; omitting it exposes default object lookup for
 * explicit object.__getattribute__ adapters without recursively applying overrides. */
export function runtimeInstanceAttribute(instance: AttributeInstanceValue, name: string, values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, invocation?: BuiltinInvocationContext): RuntimeValue {
  meter.checkpoint(1, 64);
  const key = values.string(name);
  try {
    const override = invocation === undefined ? undefined : lookupRuntimeSpecialMethod(instance, instance.type, values.string("__getattribute__"), special, values, meter);
    meter.checkpoint();
    if (override !== undefined) {
      meter.checkpoint(0, 16);
      const result = invocation!.call(override, [key]); meter.checkpoint(); return result;
    }
    const attribute = resolveRuntimeTypeAttribute(instance.type.value, key, special, values, meter)?.attribute;
    const found = readInstanceAttribute(instance, instance.type, attribute, () => {
      if (instance.kind === "instance") return instance.dictionary?.items.lookup(key);
      const stored = instance.state.attributes.get(name);
      return stored === undefined ? undefined : { value: stored };
    }, meter);
    meter.checkpoint();
    if (found !== undefined) return found.value;
    throw missingAttribute(instance, name, meter);
  } catch (error) {
    meter.checkpoint();
    if (invocation === undefined || !(error instanceof PythonRuntimeError) || error.name !== "AttributeError") throw error;
    const fallback = lookupRuntimeSpecialMethod(instance, instance.type, values.string("__getattr__"), special, values, meter); meter.checkpoint();
    if (fallback === undefined) throw error;
    meter.checkpoint(0, 16);
    const result = invocation.call(fallback, [key]); meter.checkpoint(); return result;
  }
}

/** Mutation never reads the old attribute. Overrides precede data descriptors,
 * then owned dictionary storage. Override return values are discarded. Omitting
 * invocation selects default object mutation rather than the overriding slots. */
export function runtimeMutateInstanceAttribute(instance: AttributeInstanceValue, name: string, change: { kind: "set"; value: RuntimeValue } | { kind: "delete" }, values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, invocation?: BuiltinInvocationContext): void {
  meter.checkpoint(1, 96);
  const key = values.string(name);
  const override = invocation === undefined ? undefined : lookupRuntimeSpecialMethod(instance, instance.type, values.string(change.kind === "set" ? "__setattr__" : "__delattr__"), special, values, meter);
  meter.checkpoint();
  if (override !== undefined) {
    meter.checkpoint(0, change.kind === "set" ? 24 : 16);
    invocation!.call(override, change.kind === "set" ? [key, change.value] : [key]); meter.checkpoint(); return;
  }
  const attribute = resolveRuntimeTypeAttribute(instance.type.value, key, special, values, meter)?.attribute;
  if (change.kind === "set") writeInstanceAttribute(instance, attribute, change.value, value => {
    if (instance.kind !== "instance") {
      meter.checkpoint(1, instance.state.attributes.has(name) ? 0 : 48 + 2 * name.length);
      instance.state.attributes.set(name, value); return;
    }
    if (instance.dictionary === undefined) throw missingAttribute(instance, name, meter, attribute === undefined ? "no-dictionary" : "readonly");
    instance.dictionary.items.set(key, value);
  }, meter);
  else deleteInstanceAttribute(instance, attribute, () => {
    if (instance.kind !== "instance") {
      if (!instance.state.attributes.delete(name)) throw missingAttribute(instance, name, meter);
      return;
    }
    if (instance.dictionary === undefined) throw missingAttribute(instance, name, meter, attribute === undefined ? "no-dictionary" : "readonly");
    if (!instance.dictionary.items.delete(key)) throw missingAttribute(instance, name, meter);
  }, meter);
}

import { readClassAttribute } from "./class-attributes.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { deleteInstanceAttribute, writeInstanceAttribute, type AttributeValue } from "./instance-attributes.js";
import type { RuntimeDescriptorContext } from "./runtime-descriptor.js";
import { resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import { lookupRuntimeSpecialMethod, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Ordinary class reads apply metaclass overrides and AttributeError fallback.
 * Omit invocation to expose default type lookup without recursively reapplying
 * overrides, as required by an explicit type.__getattribute__ adapter. */
export function runtimeTypeAttribute(cls: TypeValue, name: string, values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, invocation?: Pick<BuiltinInvocationContext, "call">): RuntimeValue {
  meter.checkpoint(1, 64);
  const key = values.string(name);
  try {
    const override = invocation === undefined ? undefined : lookupRuntimeSpecialMethod(cls, cls.metaclass, values.string("__getattribute__"), special, values, meter);
    meter.checkpoint();
    if (override !== undefined) {
      meter.checkpoint(0, 16);
      const result = invocation!.call(override, [key]); meter.checkpoint(); return result;
    }
    const found = readRuntimeTypeAttribute(cls, key, special, values, meter); meter.checkpoint();
    if (found !== undefined) return found.value;
    const typeName = diagnosticTypeName(cls.value.name, meter, 100);
    meter.checkpoint(0, 128 + 2 * (name.length + typeName.length));
    throw new PythonRuntimeError("AttributeError", `type object '${typeName}' has no attribute '${name}'`);
  } catch (error) {
    meter.checkpoint();
    if (invocation === undefined || !(error instanceof PythonRuntimeError) || error.name !== "AttributeError") throw error;
    const fallback = lookupRuntimeSpecialMethod(cls, cls.metaclass, values.string("__getattr__"), special, values, meter); meter.checkpoint();
    if (fallback === undefined) throw error;
    meter.checkpoint(0, 16);
    const result = invocation.call(fallback, [key]); meter.checkpoint(); return result;
  }
}

/** Default type lookup from live metaclass/class MROs. Descriptor callbacks see
 * the current class and metaclass, not merely the defining ancestor. Overrides,
 * __getattr__, intrinsic descriptor installation and missing-name diagnostics
 * belong to the object dispatcher. Absence is distinct from a stored None.
 */
export function readRuntimeTypeAttribute(
  cls: TypeValue, name: Extract<RuntimeValue, { kind: "str" }>,
  context: RuntimeDescriptorContext, values: RuntimeValues, meter: ExecutionMeter
): AttributeValue<RuntimeValue> | undefined {
  meter.checkpoint(1, 64);
  const metaclassAttribute = resolveRuntimeTypeAttribute(cls.metaclass.value, name, context, values, meter)?.attribute;
  return readClassAttribute<RuntimeValue, RuntimeValue, RuntimeValue, RuntimeValue>(cls, cls.metaclass, metaclassAttribute,
    () => resolveRuntimeTypeAttribute(cls.value, name, context, values, meter)?.attribute, meter);
}

/** Default mutation enforces type immutability before descriptor lookup. Only metaclass
 * data descriptors intercept writes/deletes; descriptors in the class namespace
 * are ordinary values here. Return false only for absent own-namespace deletion,
 * allowing the dispatcher to supply the correct AttributeError diagnostic.
 * Special metadata mutation depends on installed intrinsic metaclass descriptors.
 */
export function mutateRuntimeTypeAttribute(
  cls: TypeValue, name: Extract<RuntimeValue, { kind: "str" }>,
  change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" },
  context: RuntimeDescriptorContext, values: RuntimeValues, meter: ExecutionMeter
): boolean {
  meter.checkpoint(1, 64);
  if (cls.immutable) {
    let label = "";
    for (const point of name.value) {
      meter.checkpoint(1, point > 0xffff ? 4 : 2);
      label += String.fromCodePoint(point);
    }
    throw new PythonRuntimeError("TypeError", `cannot set '${label}' attribute of immutable type '${cls.value.name}'`);
  }
  const attribute = resolveRuntimeTypeAttribute(cls.metaclass.value, name, context, values, meter)?.attribute;
  let changed = true;
  if (change.kind === "set") {
    writeInstanceAttribute<RuntimeValue, RuntimeValue, RuntimeValue>(cls, attribute, change.value,
      value => { cls.value.namespace.items.set(name, value); }, meter);
  } else {
    deleteInstanceAttribute<RuntimeValue, RuntimeValue, RuntimeValue>(cls, attribute,
      () => { changed = cls.value.namespace.items.delete(name); }, meter);
  }
  meter.checkpoint();
  return changed;
}

import { readClassAttribute } from "./class-attributes.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { deleteInstanceAttribute, writeInstanceAttribute, type AttributeValue } from "./instance-attributes.js";
import type { RuntimeDescriptorContext } from "./runtime-descriptor.js";
import { resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

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

/** Default mutation after the caller's type-mutability checks. Only metaclass
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

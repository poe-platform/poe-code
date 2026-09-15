import { readClassAttribute } from "./class-attributes.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { deleteInstanceAttribute, writeInstanceAttribute, type AttributeValue } from "./instance-attributes.js";
import type { RuntimeDescriptorContext } from "./runtime-descriptor.js";
import { resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import { lookupRuntimeSpecialMethod, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { requireMutableRuntimeType } from "./runtime-type-mutability.js";
import { PythonUnicodeMessageError } from "./unicode-message-error.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

function missingTypeAttribute(cls: TypeValue, name: string, meter: ExecutionMeter): PythonRuntimeError {
  const typeName = diagnosticTypeName(cls.value.diagnosticName, meter, 100);
  meter.checkpoint(0, 128 + 2 * (name.length + typeName.length));
  return new PythonRuntimeError("AttributeError", `type object '${typeName}' has no attribute '${name}'`);
}

function throwTypeMutationAttributeError(cls: TypeValue, name: Extract<RuntimeValue, {kind: "str"}>, values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): never {
  const typeName = diagnosticTypeName(cls.value.diagnosticName, meter, 50);
  const message = values.string(`type object '${typeName}' has no attribute '`).value.concat(name.value, meter).concat(values.string("'").value, meter);
  const error = new PythonUnicodeMessageError("AttributeError", message, meter);
  throw invocation?.prepareException?.(error, {attribute: {name, object: cls}}) ?? error;
}

/** Ordinary class reads apply metaclass overrides and AttributeError fallback.
 * Omit invocation to expose default type lookup without recursively reapplying
 * overrides, as required by an explicit type.__getattribute__ adapter. */
export function runtimeTypeAttribute(cls: TypeValue, name: string, values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, invocation?: Pick<BuiltinInvocationContext, "call" | "isException">, lookupKey?: { value: RuntimeValue; hash: () => bigint }): RuntimeValue {
  meter.checkpoint(1, 64);
  const key = lookupKey?.value ?? values.internString(name);
  try {
    const override = invocation === undefined ? undefined : lookupRuntimeSpecialMethod(cls, cls.metaclass, values.internString("__getattribute__"), special, values, meter);
    meter.checkpoint();
    if (override !== undefined) {
      meter.checkpoint(0, 16);
      const result = invocation!.call(override, [key]); meter.checkpoint(); return result;
    }
    const found = readRuntimeTypeAttribute(cls, key, special, values, meter, lookupKey?.hash); meter.checkpoint();
    if (found !== undefined) return found.value;
    throw missingTypeAttribute(cls, name, meter);
  } catch (error) {
    meter.checkpoint();
    if (invocation === undefined || !runtimeExceptionMatches(error,"AttributeError",invocation)) throw error;
    const fallback = lookupRuntimeSpecialMethod(cls, cls.metaclass, values.internString("__getattr__"), special, values, meter); meter.checkpoint();
    if (fallback === undefined) throw error;
    meter.checkpoint(0, 16);
    const result = invocation.call(fallback, [key]); meter.checkpoint(); return result;
  }
}

/** Ordinary class writes/deletes invoke metaclass overrides without a pre-read.
 * Default mutation retains immutable-type and metaclass data-descriptor rules.
 * Omit invocation for an explicit default type setattr/delattr adapter. */
export function runtimeMutateTypeAttribute(cls: TypeValue, name: string, change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }, values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, invocation?: Pick<BuiltinInvocationContext, "call">, lookupKey?: { value: RuntimeValue; hash: () => bigint }): void {
  meter.checkpoint(1, 96);
  const key = lookupKey?.value ?? values.internString(name);
  const override = invocation === undefined ? undefined : lookupRuntimeSpecialMethod(cls, cls.metaclass, values.internString(change.kind === "set" ? "__setattr__" : "__delattr__"), special, values, meter);
  meter.checkpoint();
  if (override !== undefined) {
    meter.checkpoint(0, change.kind === "set" ? 24 : 16);
    invocation!.call(override, change.kind === "set" ? [key, change.value] : [key]);
    meter.checkpoint(); return;
  }
  const changed = mutateRuntimeTypeAttribute(cls, values.internString(name), change, special, values, meter); meter.checkpoint();
  if (!changed) throwTypeMutationAttributeError(cls, values.internString(name), values, meter, special.invocation);
}

/** Default type lookup from live metaclass/class MROs. Descriptor callbacks see
 * the current class and metaclass, not merely the defining ancestor. Overrides,
 * __getattr__, intrinsic descriptor installation and missing-name diagnostics
 * belong to the object dispatcher. Absence is distinct from a stored None.
 */
export function readRuntimeTypeAttribute(
  cls: TypeValue, name: RuntimeValue,
  context: RuntimeDescriptorContext, values: RuntimeValues, meter: ExecutionMeter, knownHash?: () => bigint
): AttributeValue<RuntimeValue> | undefined {
  meter.checkpoint(1, 64);
  const metaclassAttribute = resolveRuntimeTypeAttribute(cls.metaclass.value, name, context, values, meter, knownHash)?.attribute;
  return readClassAttribute<RuntimeValue, RuntimeValue, RuntimeValue, RuntimeValue>(cls, cls.metaclass, metaclassAttribute,
    () => resolveRuntimeTypeAttribute(cls.value, name, context, values, meter, knownHash)?.attribute, meter);
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
  requireMutableRuntimeType(cls, name, values, meter);
  const attribute = resolveRuntimeTypeAttribute(cls.metaclass.value, name, context, values, meter)?.attribute;
  let changed = true;
  const update = (value?: RuntimeValue) => {
    // type_update_dict first reads the old entry. Subtype-key equality can
    // reenter or fail here; mutation and slot invalidation must follow it.
    cls.value.namespace.items.lookup(name);
    meter.checkpoint();
    try {
      if (value === undefined) changed = cls.value.namespace.items.delete(name);
      else cls.value.namespace.items.set(name, value);
    } catch (error) {
      meter.checkpoint();
      // CPython replaces dictionary-mutation failures, but preserves failures
      // of the preceding lookup. Host faults and terminal limits escape.
      if (!(error instanceof PythonRuntimeError) && !runtimeExceptionMatches(error, "BaseException", context.invocation)) throw error;
      throwTypeMutationAttributeError(cls, name, values, meter, context.invocation);
    }
    if (changed) cls.value.nativeSlots.update(cls.value, name, values, meter, context.invocation);
  };
  if (change.kind === "set") {
    writeInstanceAttribute<RuntimeValue, RuntimeValue, RuntimeValue>(cls, attribute, change.value,
      update, meter);
  } else {
    deleteInstanceAttribute<RuntimeValue, RuntimeValue, RuntimeValue>(cls, attribute,
      update, meter);
  }
  meter.checkpoint();
  return changed;
}

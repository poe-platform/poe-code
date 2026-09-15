import { PythonRuntimeError } from "./error.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { readInstanceAttribute } from "./instance-attributes.js";
import { resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import { runtimeInstanceAttribute, runtimeMutateInstanceAttribute } from "./runtime-instance-attributes.js";
import { runtimeMutateFunctionAttribute } from "./runtime-function-mutation.js";
import { runtimeActualType, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import { lookupMroAttribute } from "./class-attributes.js";
import { mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";
import { hasRuntimeInstanceAttributes, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";

/** Default object lookup bypasses getattribute/getattr. A class is treated as a
 * metaclass instance here: own namespace values are not bound as descriptors,
 * and its base classes are not searched. Opaque/native values use host policy. */
export function runtimeObjectAttribute(object: RuntimeValue, name: string, values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, native: (object: RuntimeValue, name: string) => RuntimeValue, lookupKey?: { value: RuntimeValue; hash: () => bigint }): RuntimeValue {
  meter.checkpoint();
  if (hasRuntimeInstanceAttributes(object)) return runtimeInstanceAttribute(object, name, values, meter, special, undefined, lookupKey);
  if (object.kind !== "type") { const result = native(object, name); meter.checkpoint(); return result; }
  const key = lookupKey?.value ?? values.string(name);
  const attribute = resolveRuntimeTypeAttribute(object.metaclass.value, key, special, values, meter, lookupKey?.hash)?.attribute;
  const found = readInstanceAttribute(object, object.metaclass, attribute, () => runtimeDictionaryAccess(object.value.namespace, key, "lookup", meter), meter);
  if (found !== undefined) return found.value;
  const typeName = diagnosticTypeName(object.metaclass.value.name, meter, 100);
  meter.checkpoint(0, 128 + 2 * (name.length + typeName.length));
  throw new PythonRuntimeError("AttributeError", `'${typeName}' object has no attribute '${name}'`);
}

export function runtimeMutateObjectAttribute(object: RuntimeValue, name: string, change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }, values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, native: (object: RuntimeValue, name: string, change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }) => void, lookupKey?: { value: RuntimeValue; hash: () => bigint }): void {
  meter.checkpoint();
  if (hasRuntimeInstanceAttributes(object)) { runtimeMutateInstanceAttribute(object, name, change, values, meter, special, undefined, lookupKey); return; }
  if (object.kind === "type") throw new PythonRuntimeError("TypeError", `can't apply this __${change.kind === "set" ? "setattr" : "delattr"}__ to ${object.metaclass.value.name} object`);
  if (object.kind === "function" && runtimeMutateFunctionAttribute(object, name, change, values, meter)) return;
  const type = runtimeActualType(object, special, meter);
  const descriptor = lookupMroAttribute(type.value.mro, values.string(name), (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
  if (descriptor?.kind === "member_descriptor" || descriptor?.kind === "getset_descriptor") {
    mutateRuntimeGetsetDescriptor(descriptor, object, change, meter, special.invocation);
    return;
  }
  if (!type.value.hasInstanceDictionary) {
    const typeName = diagnosticTypeName(type.value.diagnosticName, meter, 100);
    meter.checkpoint(0, 128 + 2 * (typeName.length + name.length));
    throw new PythonRuntimeError("AttributeError", descriptor === undefined
      ? `'${typeName}' object has no attribute '${name}' and no __dict__ for setting new attributes`
      : `'${typeName}' object attribute '${name}' is read-only`);
  }
  native(object, name, change); meter.checkpoint();
}

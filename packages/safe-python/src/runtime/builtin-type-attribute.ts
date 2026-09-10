import { validateAttributeName } from "./attribute-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Native default slots bypass metaclass overrides. Descriptor binding validates
 * the receiver before this wrapper validates keywords, arity and the name. */
export function createTypeAttributeWrapper(name: "__getattribute__" | "__setattr__" | "__delattr__", values: RuntimeValues, meter: ExecutionMeter, typeType: TypeValue): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner: typeType, name, accepts(instance, meter) {
    if (instance.kind !== "type") return false;
    for (const ancestor of instance.metaclass.value.mro) { meter.checkpoint(); if (ancestor === typeType.value) return true; }
    return false;
  }, invoke(instance, positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
    const required = name === "__setattr__" ? 2 : 1;
    if (positional.length !== required) throw new PythonRuntimeError("TypeError", required === 2 ? `__setattr__ expected 2 arguments, got ${positional.length}` : `expected 1 argument, got ${positional.length}`);
    const key = positional[0];
    validateAttributeName(key, { typeName: invocation?.typeName }, meter);
    let attributeName = "";
    if (key.kind === "str") for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); attributeName += String.fromCodePoint(point); }
    if (name === "__getattribute__") {
      if (invocation?.typeAttributeDefault === undefined) throw Error("type attribute reads require a default attribute policy");
      const result = invocation.typeAttributeDefault(instance as TypeValue, attributeName);
      meter.checkpoint(); return result;
    }
    if (invocation?.mutateTypeAttributeDefault === undefined) throw Error("type attribute mutation requires a default attribute policy");
    invocation.mutateTypeAttributeDefault(instance as TypeValue, attributeName, name === "__setattr__" ? { kind: "set", value: positional[1] } : { kind: "delete" });
    meter.checkpoint(); return values.none;
  } });
}

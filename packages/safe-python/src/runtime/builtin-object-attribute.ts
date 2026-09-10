import { validateAttributeName } from "./attribute-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Explicit base-object slots. Every guest value is an object; native storage
 * and mutation applicability are validated by the execution's default policy. */
export function createObjectAttributeWrapper(name: "__getattribute__" | "__setattr__" | "__delattr__", values: RuntimeValues, meter: ExecutionMeter, objectType: TypeValue): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner: objectType, name, accepts: () => true,
    invoke(instance, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
      const required = name === "__setattr__" ? 2 : 1;
      if (positional.length !== required) throw new PythonRuntimeError("TypeError", required === 2 ? `__setattr__ expected 2 arguments, got ${positional.length}` : `expected 1 argument, got ${positional.length}`);
      if (name !== "__getattribute__" && instance.kind === "type") throw new PythonRuntimeError("TypeError", `can't apply this ${name} to ${instance.metaclass.value.name} object`);
      const key = positional[0]; validateAttributeName(key, { typeName: invocation?.typeName }, meter);
      let attributeName = "";
      if (key.kind === "str") for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); attributeName += String.fromCodePoint(point); }
      if (name === "__getattribute__") {
        if (invocation?.objectAttributeDefault === undefined) throw Error("object attribute reads require a default attribute policy");
        const result = invocation.objectAttributeDefault(instance, attributeName); meter.checkpoint(); return result;
      }
      if (invocation?.mutateObjectAttributeDefault === undefined) throw Error("object attribute mutation requires a default attribute policy");
      invocation.mutateObjectAttributeDefault(instance, attributeName, name === "__setattr__" ? { kind: "set", value: positional[1] } : { kind: "delete" });
      meter.checkpoint(); return values.none;
    }
  });
}

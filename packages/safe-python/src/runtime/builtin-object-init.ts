import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { lookupMroAttribute } from "./class-attributes.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Default object initialization performs no writes. Extra arguments are legal
 * only when the actual class inherits this initializer and overrides allocation.
 * Native/opaque actual types come from the execution policy, never __class__. */
export function createObjectInitWrapper(values: RuntimeValues, meter: ExecutionMeter, objectType: TypeValue): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  const initName = values.string("__init__"), newName = values.string("__new__");
  const defaultNew = objectType.value.namespace.items.lookup(newName)?.value;
  const initializer: WrapperDescriptorValue = values.wrapperDescriptor({ owner: objectType, name: "__init__", accepts: () => true, invoke(instance, positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (positional.length === 0 && keywords.items.size === 0) return values.none;
    const type = instance.kind === "instance" ? instance.type : instance.kind === "type" ? instance.metaclass : invocation?.actualType?.(instance);
    meter.checkpoint();
    if (type === undefined) throw Error("object initialization requires an actual type policy");
    const actualInit = lookupMroAttribute(type.value.mro, initName, (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
    if (actualInit !== initializer) throw new PythonRuntimeError("TypeError", "object.__init__() takes exactly one argument (the instance to initialize)");
    const actualNew = lookupMroAttribute(type.value.mro, newName, (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
    if (actualNew === defaultNew) throw new PythonRuntimeError("TypeError", `${diagnosticTypeName(type.value.name, meter)}.__init__() takes exactly one argument (the instance to initialize)`);
    return values.none;
  } });
  return initializer;
}

import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { lookupRuntimeSpecialMethod, runtimeActualType, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

export interface RuntimeTypeFinalizationContext extends Pick<BuiltinInvocationContext, "call"> {
  /** Ordinary guest repr for the namespace key in a failing set-name note. */
  repr(value: RuntimeValue): string;
}

/** Complete post-allocation hooks on a ready class. Own descriptor values/keys
 * are snapshotted once; their special methods and the inherited subclass hook
 * are resolved live. Automatic static/classmethod wrapping must already have
 * happened. This stage deliberately does not roll back namespace/cell effects.
 */
export function finalizeRuntimeType(type: TypeValue, keywords: DictionaryValue, special: RuntimeSpecialMethodContext, values: RuntimeValues, meter: ExecutionMeter, context: RuntimeTypeFinalizationContext): void {
  meter.checkpoint(1, 128);
  if (type.value.mro.length === 0) throw Error("cannot finalize a type without an initialized MRO");
  const entries = type.value.namespace.items.snapshot(), setName = values.string("__set_name__");
  for (const [name, descriptor] of entries) {
    const actual = runtimeActualType(descriptor, special, meter);
    const hook = lookupRuntimeSpecialMethod(descriptor, actual, setName, special, values, meter); meter.checkpoint();
    if (hook === undefined) continue;
    try {
      meter.checkpoint(0, 32); context.call(hook, [type, name]); meter.checkpoint();
    } catch (error) {
      meter.checkpoint();
      if (error instanceof PythonRuntimeError) {
        const descriptorName = diagnosticTypeName(actual.value.name, meter, 100), className = diagnosticTypeName(type.value.name, meter, 100);
        const key = context.repr(name); meter.checkpoint(0, 128 + 2 * (descriptorName.length + className.length + key.length));
        error.addNote(`Error calling __set_name__ on '${descriptorName}' instance ${key} in '${className}'`, meter);
      }
      throw error;
    }
  }
  const initName = values.string("__init_subclass__");
  for (let index = 1; index < type.value.mro.length; index++) {
    meter.checkpoint();
    const found = type.value.mro[index].namespace.items.lookup(initName);
    if (found === undefined) continue;
    const attribute = resolveRuntimeClassAttribute(found.value, special, values, meter);
    const hook = attribute.slots?.get === undefined ? attribute.value : attribute.slots.get(null, type); meter.checkpoint();
    meter.checkpoint(0, 24); context.call(hook, [], keywords); meter.checkpoint(); return;
  }
}

import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeTypeLayout } from "./runtime-type-layout.js";
import type { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { hasRuntimeInstanceAttributes, type BuiltinInvocationContext, type GetsetDescriptorValue, type RuntimeValue, type RuntimeValues, type TypeValue } from "./runtime-values.js";

function actualClass(value: RuntimeValue, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): TypeValue {
  meter.checkpoint();
  if (hasRuntimeInstanceAttributes(value)) return value.type;
  if (value.kind === "type") return value.metaclass;
  if (invocation?.actualType === undefined) throw Error("class reflection requires an actual type policy");
  const type = invocation.actualType(value); meter.checkpoint(); return type;
}

/** Native payload ancestry is part of layout identity, not just dictionary
 * availability. Slot-bearing layouts will additionally need slot signatures. */
function nativeLayout(type: TypeValue, meter: ExecutionMeter): RuntimeTypeLayout | undefined {
  let layout: RuntimeTypeLayout | undefined;
  for (const ancestor of type.value.mro) { meter.checkpoint(); if (!ancestor.hasObjectLayout) layout = ancestor; }
  return layout;
}

/** Data descriptor for actual type reflection and compatible heap reassignment.
 * Existing dictionaries, payloads and captured bound methods are left intact. */
export function createObjectClassDescriptor(values: RuntimeValues, meter: ExecutionMeter, registry: RuntimeTypeRegistry): GetsetDescriptorValue {
  meter.checkpoint(1, 96);
  return values.getsetDescriptor({ owner: registry.object, name: "__class__", accepts: () => true,
    get: actualClass,
    set(receiver, next, meter, invocation) {
      if (next.kind !== "type") {
        const name = hasRuntimeInstanceAttributes(next) ? next.type.value.name : next.kind === "none" ? "NoneType" : next.kind === "not-implemented" ? "NotImplementedType" : next.kind;
        meter.checkpoint(0, 128 + 2 * name.length);
        throw new PythonRuntimeError("TypeError", `__class__ must be set to a class, not '${name}' object`);
      }
      const current = actualClass(receiver, meter, invocation);
      if (registry.resolve(current.value) !== current || registry.resolve(next.value) !== next) throw Error("class assignment requires types owned by this registry");
      if (current.immutable || next.immutable) throw new PythonRuntimeError("TypeError", "__class__ assignment only supported for mutable types or ModuleType subclasses");
      if (current.value.hasInstanceDictionary !== next.value.hasInstanceDictionary || nativeLayout(current, meter) !== nativeLayout(next, meter)) {
        meter.checkpoint(0, 128 + 2 * (current.value.name.length + next.value.name.length));
        throw new PythonRuntimeError("TypeError", `__class__ assignment: '${next.value.name}' object layout differs from '${current.value.name}'`);
      }
      if (receiver.kind === "type") receiver.assignMetaclass(next, meter);
      else if (receiver.kind === "instance" || receiver.kind === "staticmethod" || receiver.kind === "classmethod") receiver.state.assignType(next, meter);
      else {
        if (invocation?.assignClassDefault === undefined) throw Error("native class assignment requires a storage policy");
        invocation.assignClassDefault(receiver, next); meter.checkpoint();
      }
    },
    delete(_receiver, meter) {
      meter.checkpoint(); throw new PythonRuntimeError("TypeError", "can't delete __class__ attribute");
    }
  });
}

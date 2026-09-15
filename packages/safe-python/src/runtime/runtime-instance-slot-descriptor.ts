import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { hasRuntimeInstanceAttributes, type RuntimeValue, type RuntimeValues, type TypeValue } from "./runtime-values.js";
import { createInstanceDictionaryDescriptor } from "./runtime-instance-dictionary-descriptor.js";
import type { RuntimeSlotDeclaration } from "./runtime-slot-declaration.js";

/** Slot descriptors use offsets, not names, so inherited/duplicate declarations
 * stay independent and compatible class reassignment preserves stored values. */
export function installRuntimeInstanceSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter, declaration?: RuntimeSlotDeclaration): void {
  const accepts = (instance: RuntimeValue, meter: ExecutionMeter) => {
    if (!hasRuntimeInstanceAttributes(instance)) return false;
    for (const ancestor of instance.type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) return true; }
    return false;
  };
  const inherited = owner.value.layoutBase?.slotCount ?? 0;
  for (let index = 0; index < owner.value.slotNames.length; index++) {
    meter.checkpoint(1, 128);
    const name = owner.value.slotNames[index], position = inherited + index;
    const missing = (): never => { throw new PythonRuntimeError("AttributeError", name); };
    owner.value.namespace.items.set(values.string(name), values.memberDescriptor({
      owner, name, accepts,
      get(instance) {
        if (!hasRuntimeInstanceAttributes(instance)) throw Error("slot descriptor requires owned instance storage");
        const value = instance.state.slots.get(position);
        if (value === undefined) throw new PythonRuntimeError("AttributeError", `'${instance.type.value.name}' object has no attribute '${name}'`);
        return value;
      },
      set(instance, value) {
        if (!hasRuntimeInstanceAttributes(instance)) throw Error("slot descriptor requires owned instance storage");
        instance.state.slots.set(position, value);
      },
      delete(instance) {
        if (!hasRuntimeInstanceAttributes(instance)) throw Error("slot descriptor requires owned instance storage");
        if (instance.state.slots.get(position) === undefined) missing();
        instance.state.slots.set(position, undefined);
      }
    }));
  }
  let inheritedWeakReferences = false, inheritedDictionary = false;
  for (const base of owner.value.bases) { meter.checkpoint(); inheritedWeakReferences ||= base.hasWeakReferences; inheritedDictionary ||= base.hasInstanceDictionary; }
  const dictionaryKey = values.string("__dict__");
  if (owner.value.hasInstanceDictionary && (declaration?.dictionary || !inheritedDictionary && owner.value.namespace.items.lookup(dictionaryKey) === undefined)) {
    owner.value.namespace.items.set(dictionaryKey, createInstanceDictionaryDescriptor(owner, values, meter));
  }
  const weakKey = values.string("__weakref__");
  if (owner.value.hasWeakReferences && (declaration?.weakReferences || !inheritedWeakReferences && owner.value.namespace.items.lookup(weakKey) === undefined)) {
    meter.checkpoint(1, 96);
    owner.value.namespace.items.set(weakKey, values.getsetDescriptor({ owner, name: "__weakref__", doc: "list of weak references to the object", accepts, get: () => values.none }));
  }
}

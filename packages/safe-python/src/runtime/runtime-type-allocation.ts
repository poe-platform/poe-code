import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { RuntimeTypeLayout, validateRuntimeBaseLayouts, type RuntimeTypeLayoutOptions } from "./runtime-type-layout.js";
import { RuntimeTypeNames } from "./runtime-type-names.js";
import type { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import type { DictionaryValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";
import { createInstanceDictionaryDescriptor } from "./runtime-instance-dictionary-descriptor.js";

export interface RuntimeTypeAllocationOptions {
  /** Defining frame's __name__, used only when the namespace omits __module__. */
  readonly module?: RuntimeValue;
  /** Already validated storage decisions from the slots/native-layout layer. */
  readonly layout?: Omit<RuntimeTypeLayoutOptions, "qualifiedName" | "beforeMro">;
}

/** Allocate one canonical class from a selected metaclass and validated bases.
 * This owns namespace copying, intrinsic metadata and class-cell propagation.
 * Exact function-valued reserved methods receive their automatic wrappers.
 * Metaclass selection/delegation, slot layout validation, __set_name__ and
 * __init_subclass__ belong to the enclosing type-new
 * lifecycle. Do not expose this stage as a standalone guest type.__new__.
 */
export function allocateRuntimeType(name: Extract<RuntimeValue, { kind: "str" }>, bases: readonly TypeValue[], source: DictionaryValue, metaclass: TypeValue, registry: RuntimeTypeRegistry, values: RuntimeValues, meter: ExecutionMeter, options: RuntimeTypeAllocationOptions = {}): TypeValue {
  meter.checkpoint(1, 192 + bases.length * 8);
  const baseLayouts: RuntimeTypeLayout[] = [];
  for (const base of bases) { meter.checkpoint(); baseLayouts.push(base.value); }
  if (baseLayouts.length === 0) { meter.checkpoint(0, 8); baseLayouts.push(registry.object.value); }
  validateRuntimeBaseLayouts(baseLayouts, meter);
  const names = new RuntimeTypeNames("", "", meter);
  names.set("__name__", name, meter);
  const namespace = values.dictionary(source.items.copy());
  const qualifiedKey = values.string("__qualname__"), cellKey = values.string("__classcell__");
  const qualified = namespace.items.lookup(qualifiedKey)?.value ?? name;
  if (qualified.kind !== "str") {
    const actual = qualified.kind === "instance" ? qualified.type.value.name : qualified.kind === "type" ? qualified.metaclass.value.name : qualified.kind === "none" ? "NoneType" : qualified.kind === "not-implemented" ? "NotImplementedType" : qualified.kind;
    meter.checkpoint(0, 96 + 2 * actual.length);
    throw new PythonRuntimeError("TypeError", `type __qualname__ must be a str, not ${actual}`);
  }
  namespace.items.delete(qualifiedKey);
  const cell = namespace.items.lookup(cellKey)?.value;
  if (cell !== undefined && cell.kind !== "cell") {
    const actual = cell.kind === "instance" ? cell.type.value.name : cell.kind === "type" ? cell.metaclass.value.name : cell.kind === "none" ? "NoneType" : cell.kind === "not-implemented" ? "NotImplementedType" : cell.kind;
    meter.checkpoint(0, 128 + 2 * actual.length);
    throw new PythonRuntimeError("TypeError", `__classcell__ must be a nonlocal cell, not <class '${actual}'>`);
  }
  namespace.items.delete(cellKey);
  const moduleKey = values.string("__module__"), docKey = values.string("__doc__");
  if (options.module !== undefined && namespace.items.lookup(moduleKey) === undefined) namespace.items.set(moduleKey, options.module);
  for (const methodName of ["__new__", "__init_subclass__", "__class_getitem__"] as const) {
    const key = values.string(methodName), method = namespace.items.lookup(key)?.value;
    if (method?.kind === "function") {
      const kind = methodName === "__new__" ? "staticmethod" : "classmethod";
      namespace.items.set(key, values.methodDecorator(kind, method, registry.methodDecoratorType(kind)));
    }
  }
  let result: TypeValue | undefined;
  new RuntimeTypeLayout(names.name, baseLayouts, namespace, meter, { ...options.layout, beforeMro(layout) {
    layout.names.set("__name__", name, meter); layout.names.set("__qualname__", qualified, meter);
    result = registry.publish(layout, metaclass);
    if (cell !== undefined) { meter.checkpoint(0, 16); cell.value.content = { value: result }; }
  } });
  if (result === undefined) throw Error("type allocation did not publish its layout");
  let inheritedDictionary = false;
  for (const base of baseLayouts) { meter.checkpoint(); inheritedDictionary ||= base.hasInstanceDictionary; }
  const dictionaryKey = values.string("__dict__");
  // Native payload layouts supply their own storage descriptors (notably type's
  // class namespace mapping proxy); this getset accesses plain instance state.
  if (result.value.hasObjectLayout && result.value.hasInstanceDictionary && !inheritedDictionary && namespace.items.lookup(dictionaryKey) === undefined) {
    namespace.items.set(dictionaryKey, createInstanceDictionaryDescriptor(result, values, meter));
  }
  if (namespace.items.lookup(docKey) === undefined) namespace.items.set(docKey, values.none);
  meter.checkpoint(); return result;
}

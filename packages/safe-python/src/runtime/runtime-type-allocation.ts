import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { RuntimeTypeLayout, selectRuntimeLayoutBase, type RuntimeTypeLayoutOptions } from "./runtime-type-layout.js";
import { RuntimeTypeNames } from "./runtime-type-names.js";
import type { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import type { DictionaryValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";
import { prepareRuntimeSlotDeclaration } from "./runtime-slot-declaration.js";
import { installRuntimeInstanceSlots } from "./runtime-instance-slot-descriptor.js";
import type { IterationContext } from "./protocol-iterator.js";

export interface RuntimeTypeAllocationOptions {
  /** Defining frame's __name__, used only when the namespace omits __module__. */
  readonly module?: RuntimeValue;
  readonly iteration?: IterationContext<RuntimeValue>;
  /** Internal native storage decisions; explicit source slots override own
   * slot/dictionary/weak-reference defaults without removing inherited storage. */
  readonly layout?: Omit<RuntimeTypeLayoutOptions, "qualifiedName" | "beforeMro">;
}

/** Allocate one canonical class from a selected metaclass and validated bases.
 * This owns namespace copying, intrinsic metadata and class-cell propagation.
 * Exact function-valued reserved methods receive their automatic wrappers.
 * Metaclass selection/delegation, unrepresented native sizing, __set_name__ and
 * __init_subclass__ belong to the enclosing type-new
 * lifecycle. Do not expose this stage as a standalone guest type.__new__.
 */
export function allocateRuntimeType(name: Extract<RuntimeValue, { kind: "str" }>, bases: readonly TypeValue[], source: DictionaryValue, metaclass: TypeValue, registry: RuntimeTypeRegistry, values: RuntimeValues, meter: ExecutionMeter, options: RuntimeTypeAllocationOptions = {}): TypeValue {
  meter.checkpoint(1, 192 + bases.length * 8);
  const baseLayouts: RuntimeTypeLayout[] = [];
  for (const base of bases) { meter.checkpoint(); baseLayouts.push(base.value); }
  if (baseLayouts.length === 0) { meter.checkpoint(0, 8); baseLayouts.push(registry.object.value); }
  const layoutBase = selectRuntimeLayoutBase(baseLayouts, meter)!;
  const namespace = values.dictionary(source.items.copy());
  const slotSource = namespace.items.lookup(values.string("__slots__"))?.value;
  let className = "";
  for (const point of name.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); className += String.fromCodePoint(point); }
  const slots = slotSource === undefined ? undefined : prepareRuntimeSlotDeclaration(className, slotSource, {
    namespace, dictionaryAllowed: !layoutBase.hasInstanceDictionary, weakReferencesAllowed: !layoutBase.hasWeakReferences,
    variableSizedBase: layoutBase.variableSized ? layoutBase.name : undefined, iteration: options.iteration
  }, values, meter);
  const names = new RuntimeTypeNames("", "", meter);
  names.set("__name__", name, meter);
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
  const defaultModule = options.module !== undefined && namespace.items.lookup(moduleKey) === undefined;
  if (defaultModule) namespace.items.set(moduleKey, options.module!);
  for (const methodName of ["__new__", "__init_subclass__", "__class_getitem__"] as const) {
    const key = values.string(methodName), method = namespace.items.lookup(key)?.value;
    if (method?.kind === "function") {
      const kind = methodName === "__new__" ? "staticmethod" : "classmethod";
      namespace.items.set(key, values.methodDecorator(kind, method, registry.methodDecoratorType(kind)));
    }
  }
  let result: TypeValue | undefined;
  new RuntimeTypeLayout(names.name, baseLayouts, namespace, meter, { ...options.layout,
    ...(slots === undefined ? {} : { slots: slots.names, instanceDictionary: slots.dictionary, weakReferences: slots.weakReferences }),
    beforeMro(layout) {
    layout.names.set("__name__", name, meter); layout.names.set("__qualname__", qualified, meter);
    result = registry.publish(layout, metaclass);
    if (cell !== undefined) { meter.checkpoint(0, 16); cell.value.content = { value: result }; }
  } });
  if (result === undefined) throw Error("type allocation did not publish its layout");
  installRuntimeInstanceSlots(result, values, meter, slots);
  if (defaultModule && slots !== undefined) {
    for (const name of slots.names) { meter.checkpoint(); if (name === "__module__") { namespace.items.set(moduleKey, options.module!); break; } }
  }
  if (namespace.items.lookup(docKey) === undefined) namespace.items.set(docKey, values.none);
  if (namespace.items.lookup(values.string("__eq__")) !== undefined) {
    const hashKey = values.string("__hash__");
    if (namespace.items.lookup(hashKey) === undefined) namespace.items.set(hashKey, values.none);
  }
  meter.checkpoint(); return result;
}

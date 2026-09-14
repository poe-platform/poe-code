import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { RuntimeTypeLayout, selectRuntimeLayoutBase, type RuntimeTypeLayoutOptions } from "./runtime-type-layout.js";
import { RuntimeTypeNames } from "./runtime-type-names.js";
import type { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";
import { prepareRuntimeSlotDeclaration } from "./runtime-slot-declaration.js";
import { installRuntimeInstanceSlots } from "./runtime-instance-slot-descriptor.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import { encodeUtf8 } from "./utf8-encode.js";
import { PythonEncodeError } from "./encode-error.js";
import { parseRuntimeTypeDocumentation } from "./runtime-type-documentation.js";

export interface RuntimeTypeAllocationOptions {
  /** Defining frame's __name__, used only when the namespace omits __module__. */
  readonly module?: RuntimeValue;
  readonly iteration?: IterationContext<RuntimeValue>;
  readonly prepareException?: BuiltinInvocationContext["prepareException"];
  readonly isException?: BuiltinInvocationContext["isException"];
  readonly nativeHash?: BuiltinInvocationContext["nativeHash"];
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
  // CPython uses interned identifiers for these intrinsic namespace lookups.
  // Equal str-subclass keys can observe the actual query object.
  const slotSource = namespace.items.lookup(values.internString("__slots__"))?.value;
  let className = "";
  for (const point of name.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); className += String.fromCodePoint(point); }
  const slots = slotSource === undefined ? undefined : prepareRuntimeSlotDeclaration(className, slotSource, {
    namespace, dictionaryAllowed: !layoutBase.hasInstanceDictionary, weakReferencesAllowed: !layoutBase.hasWeakReferences,
    variableSizedBase: layoutBase.variableSized ? layoutBase.name : undefined, iteration: options.iteration
  }, values, meter);
  const names = new RuntimeTypeNames("", "", meter);
  names.set("__name__", name, meter);
  const moduleKey = values.internString("__module__"), docKey = values.internString("__doc__");
  const defaultModule = namespace.items.lookup(moduleKey) === undefined && options.module !== undefined;
  if (defaultModule) namespace.items.set(moduleKey, options.module!);
  const qualifiedKey = values.internString("__qualname__"), cellKey = values.internString("__classcell__");
  const qualified = namespace.items.lookup(qualifiedKey)?.value ?? name;
  if (qualified.kind !== "str") {
    const actual = qualified.kind === "instance" ? qualified.type.value.name : qualified.kind === "type" ? qualified.metaclass.value.name : qualified.kind === "none" ? "NoneType" : qualified.kind === "not-implemented" ? "NotImplementedType" : qualified.kind;
    meter.checkpoint(0, 96 + 2 * actual.length);
    throw new PythonRuntimeError("TypeError", `type __qualname__ must be a str, not ${actual}`);
  }
  namespace.items.delete(qualifiedKey);
  const doc = namespace.items.lookup(docKey)?.value;
  const text = doc === undefined ? undefined : runtimeStringPayload(doc);
  let internalDocumentation: string | undefined;
  if (text !== undefined) {
    // Validate the entire string before strlen-style truncation, including
    // surrogates after a NUL. Never dispatch through a guest encode override.
    // Compact Latin-1 storage proves that no surrogate is present. Like the
    // native ASCII path, reuse that invariant instead of allocating and then
    // discarding an encoded buffer for ordinary library documentation.
    try { if (text.value.compactWidth(meter) !== 1) encodeUtf8(text.value, "strict", meter); }
    catch (error) {
      if (error instanceof PythonEncodeError && options.prepareException !== undefined) throw options.prepareException(error, {unicodeObject: doc});
      throw error;
    }
    internalDocumentation = "";
    for (const point of text.value) {
      meter.checkpoint(1, point > 0xffff ? 4 : 2);
      if (point === 0) break;
      internalDocumentation += String.fromCodePoint(point);
    }
  }
  for (const methodName of ["__new__", "__init_subclass__", "__class_getitem__"] as const) {
    const key = values.internString(methodName), method = namespace.items.lookup(key)?.value;
    if (method?.kind === "function") {
      const kind = methodName === "__new__" ? "staticmethod" : "classmethod";
      namespace.items.set(key, values.methodDecorator(kind, method, registry.methodDecoratorType(kind)));
    }
  }
  const cell = namespace.items.lookup(cellKey)?.value;
  if (cell !== undefined && cell.kind !== "cell") {
    const actual = cell.kind === "instance" ? cell.type.value.name : cell.kind === "type" ? cell.metaclass.value.name : cell.kind === "none" ? "NoneType" : cell.kind === "not-implemented" ? "NotImplementedType" : cell.kind;
    meter.checkpoint(0, 128 + 2 * actual.length);
    throw new PythonRuntimeError("TypeError", `__classcell__ must be a nonlocal cell, not <class '${actual}'>`);
  }
  namespace.items.delete(cellKey);
  let result: TypeValue | undefined;
  new RuntimeTypeLayout(names.name, baseLayouts, namespace, meter, { ...options.layout,
    internalDocumentation,
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
  result.value.nativeSlots.prepare(result.value, values, meter);
  if (namespace.items.lookup(docKey) === undefined) namespace.items.set(docKey, internalDocumentation === undefined ? values.none
    : values.string(parseRuntimeTypeDocumentation(result.value.diagnosticName, internalDocumentation, meter).doc));
  result.value.nativeSlots.initialize(result.value, values, meter, options);
  meter.checkpoint(); return result;
}

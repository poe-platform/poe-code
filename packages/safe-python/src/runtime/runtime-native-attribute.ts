import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeDictionaryMethod } from "./runtime-dictionary-method.js";
import { createRuntimeDictionaryMutationMethod } from "./runtime-dictionary-mutation-method.js";
import { readRuntimeDictionaryViewAttribute } from "./runtime-dictionary-view-attributes.js";
import { createRuntimeSetAlgebraMethod } from "./runtime-set-algebra-method.js";
import { createRuntimeSetMutationMethod } from "./runtime-set-mutation-method.js";
import { createRuntimeSetRelationMethod } from "./runtime-set-relation-method.js";
import { isRuntimeSet, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";

/** Default exact-value lookup. Only explicitly implemented Python members are
 * exposed; host payload fields and JavaScript prototypes are never inspected.
 * Custom object policies can replace this operation in expression bindings.
 * Type descriptors, inherited object members and native introspection remain
 * separate from these instance-bound container capabilities. */
export function runtimeNativeAttribute(receiver: RuntimeValue, name: string, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  if (receiver.kind === "dict" || receiver.kind === "mappingproxy") {
    switch (name) {
      case "get": case "copy": case "keys": case "values": case "items": case "__reversed__":
        return createRuntimeDictionaryMethod(receiver, name, values, meter);
      case "clear": case "pop": case "popitem": case "setdefault": case "update":
        if (receiver.kind === "dict") return createRuntimeDictionaryMutationMethod(receiver, name, values, meter);
    }
  }
  if (receiver.kind === "dict_keys" || receiver.kind === "dict_items" || receiver.kind === "dict_values") {
    const result = readRuntimeDictionaryViewAttribute(receiver, name, values, meter);
    if (result !== undefined) return result;
  }
  if (isRuntimeSet(receiver)) {
    switch (name) {
      case "copy": case "isdisjoint": case "issubset": case "issuperset":
        return createRuntimeSetRelationMethod(receiver, name, values, meter);
      case "union": case "intersection": case "difference": case "symmetric_difference":
        return createRuntimeSetAlgebraMethod(receiver, name, values, meter);
      case "add": case "remove": case "discard": case "pop": case "clear": case "update":
      case "intersection_update": case "difference_update": case "symmetric_difference_update":
        if (receiver.kind === "set") return createRuntimeSetMutationMethod(receiver, name, values, meter);
    }
  }
  meter.checkpoint(1, 128 + 2 * name.length);
  throw new PythonRuntimeError("AttributeError", `'${receiver.kind}' object has no attribute '${name}'`);
}

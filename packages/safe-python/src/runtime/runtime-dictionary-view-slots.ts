import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { callRuntimeDictionaryViewMethod } from "./runtime-dictionary-view-attributes.js";
import { runtimeDictionaryViewBinary } from "./runtime-dictionary-view-algebra.js";
import { iterateRuntimeDictionaryView } from "./runtime-dictionary-view.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import { runtimeReceiverComparison } from "./runtime-receiver-comparison.js";
import type { DictionaryViewValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Exact view descriptors retain the view and its live dictionary storage.
 * Values views deliberately omit set comparison, containment and algebra slots. */
export function installRuntimeDictionaryViewSlots(kind: DictionaryViewValue["kind"], owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 256);
  const slots = [["__len__", "Return len(self)."], ["__iter__", "Implement iter(self)."], ["__repr__", "Return repr(self)."]];
  const comparisons = new Map([["__eq__", "=="], ["__ne__", "!="], ["__lt__", "<"], ["__le__", "<="], ["__gt__", ">"], ["__ge__", ">="]]);
  if (kind !== "dict_values") {
    owner.value.namespace.items.set(values.string("__hash__"), values.none);
    slots.push(["__contains__", "Return bool(key in self)."]);
    for (const [name, operator] of comparisons) slots.push([name, `Return self${operator}value.`]);
  }
  for (const [name, doc] of slots) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === kind,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        const operator = comparisons.get(name), count = operator !== undefined || name === "__contains__" ? 1 : 0;
        if (positional.length !== count) throw new PythonRuntimeError("TypeError", `expected ${count} argument${count === 1 ? "" : "s"}, got ${positional.length}`);
        if (receiver.kind !== kind) throw Error("dictionary view slot requires matching view storage");
        if (name === "__len__") return values.integer(receiver.value.items.size);
        if (name === "__iter__") return values.iterator(iterateRuntimeDictionaryView(receiver, values, meter));
        if (name === "__repr__") return runtimeNativeRepresentation(receiver, name, values, meter, invocation);
        if (name === "__contains__") return runtimeMembership("in", positional[0], receiver, values, meter, undefined, invocation);
        return runtimeReceiverComparison(operator!, receiver, positional[0], values, meter, undefined, invocation);
      }
    }));
  }
  for (const name of kind === "dict_values" ? ["__reversed__"] as const : ["__reversed__", "isdisjoint"] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc: name === "__reversed__" ? `Return a reverse iterator over the dict ${kind.slice(5)}.` : "Return True if the view and the given iterable have a null intersection.", accepts: receiver => receiver.kind === kind,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (receiver.kind !== kind) throw Error("dictionary view method requires matching view storage");
        return callRuntimeDictionaryViewMethod(receiver, name, positional, keywords, values, meter, invocation);
      }
    }));
  }
  owner.value.namespace.items.set(values.string("mapping"), values.getsetDescriptor({ owner, name: "mapping", doc: "dictionary that this view refers to", accepts: receiver => receiver.kind === kind,
    get(receiver, meter) {
      meter.checkpoint();
      if (receiver.kind !== kind) throw Error("dictionary view mapping requires matching view storage");
      return values.mappingProxy(receiver.value, receiver.owner);
    }
  }));
  if (kind === "dict_values") return;
  for (const [suffix, operator] of [["or", "|"], ["and", "&"], ["sub", "-"], ["xor", "^"]] as const) {
    for (const reflected of [false, true]) {
      const name = `__${reflected ? "r" : ""}${suffix}__`;
      meter.checkpoint(0, 96);
      owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc: `Return ${reflected ? "value" : "self"}${operator}${reflected ? "self" : "value"}.`, accepts: receiver => receiver.kind === kind,
        invoke(receiver, positional, keywords, meter, invocation) {
          meter.checkpoint();
          if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
          if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
          return runtimeDictionaryViewBinary(operator, reflected ? positional[0] : receiver, reflected ? receiver : positional[0], values, meter, invocation?.iteration, invocation);
        }
      }));
    }
  }
}

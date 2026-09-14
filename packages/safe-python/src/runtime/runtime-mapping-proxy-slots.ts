import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { callRuntimeDictionaryMethod } from "./runtime-dictionary-method.js";
import { runtimeLength } from "./runtime-length.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeGetItem } from "./runtime-subscription.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** A proxy retains its original mapping. Explicit slots delegate complete
 * operations to that mapping, including guest reflection and truth conversion. */
export function installRuntimeMappingProxySlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  owner.value.namespace.items.set(values.string("__doc__"), values.string("Read-only proxy of a mapping."));
  const comparisons = new Map([["__eq__", "=="], ["__ne__", "!="], ["__lt__", "<"], ["__le__", "<="], ["__gt__", ">"], ["__ge__", ">="]]);
  const slots = [["__len__", "Return len(self)."], ["__iter__", "Implement iter(self)."], ["__getitem__", "Return self[key]."],
    ["__contains__", "Return bool(key in self)."], ["__repr__", "Return repr(self)."], ["__str__", "Return str(self)."],
    ["__hash__", "Return hash(self)."], ["__or__", "Return self|value."], ["__ror__", "Return value|self."], ["__ior__", "Return self|=value."]];
  for (const [name, operator] of comparisons) slots.push([name, `Return self${operator}value.`]);
  for (const [name, doc] of slots) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "mappingproxy",
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        const operator = comparisons.get(name);
        const count = operator !== undefined || name === "__getitem__" || name === "__contains__" || name === "__or__" || name === "__ror__" || name === "__ior__" ? 1 : 0;
        if (positional.length !== count) throw new PythonRuntimeError("TypeError", `expected ${count} argument${count === 1 ? "" : "s"}, got ${positional.length}`);
        if (receiver.kind !== "mappingproxy") throw Error("mapping proxy slot requires proxy storage");
        if (name === "__len__") return values.integer(runtimeLength(receiver, meter, undefined, invocation));
        if (name === "__iter__") return values.iterator(runtimeIterate(receiver, values, meter, invocation?.iteration, undefined, false));
        if (name === "__getitem__") return runtimeGetItem(receiver, positional[0], values, meter, invocation, invocation?.integerIndex);
        if (name === "__repr__" || name === "__str__") return runtimeNativeRepresentation(receiver, name, values, meter, invocation);
        if (name === "__hash__") {
          if (invocation?.nativeHash === undefined) throw Error("mapping proxy hashing requires a native hash policy");
          let hash: bigint;
          try { hash = invocation.nativeHash(receiver); }
          catch (error) { throw error instanceof RuntimeHashError ? error.original : error; }
          meter.checkpoint(); return values.integer(hash);
        }
        if (name === "__ior__") throw new PythonRuntimeError("TypeError", "'|=' is not supported by mappingproxy; use '|' instead");
        if (name === "__or__" || name === "__ror__") {
          if (invocation?.binary === undefined) throw Error("mapping proxy union requires a binary policy");
          return name === "__or__" ? invocation.binary("|", receiver.value, positional[0]) : invocation.binary("|", positional[0], receiver.value);
        }
        if (invocation?.compare === undefined) throw Error("mapping proxy comparison requires a comparison policy");
        return name === "__contains__" ? invocation.compare("in", positional[0], receiver.value) : invocation.compare(operator!, receiver.value, positional[0]);
      }
    }));
  }
  for (const [name, doc] of [["get", "Return the value for key if key is in the mapping, else default."],
    ["keys", "D.keys() -> a set-like object providing a view on D's keys"], ["values", "D.values() -> an object providing a view on D's values"],
    ["items", "D.items() -> a set-like object providing a view on D's items"], ["copy", "D.copy() -> a shallow copy of D"],
    ["__reversed__", "D.__reversed__() -> reverse iterator"]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "mappingproxy",
      invoke(receiver, positional, keywords, meter, invocation) {
        if (receiver.kind !== "mappingproxy") throw Error("mapping proxy method requires proxy storage");
        return callRuntimeDictionaryMethod(receiver, name, positional, keywords, values, meter, invocation);
      }
    }));
  }
}

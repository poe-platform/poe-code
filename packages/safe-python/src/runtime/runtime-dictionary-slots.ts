import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Exact dictionary protocols use one storage operation per key access. */
export function installRuntimeDictionarySlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 256);
  owner.value.namespace.items.set(values.string("__hash__"), values.none);
  for (const [name, doc] of [["__len__", "Return len(self)."], ["__iter__", "Implement iter(self)."],
    ["__repr__", "Return repr(self)."], ["__setitem__", "Set self[key] to value."], ["__delitem__", "Delete self[key]."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "dict",
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        const count = name === "__setitem__" ? 2 : name === "__delitem__" ? 1 : 0;
        if (positional.length !== count) throw new PythonRuntimeError("TypeError", `${name === "__setitem__" ? "__setitem__ " : ""}expected ${count} argument${count === 1 ? "" : "s"}, got ${positional.length}`);
        if (receiver.kind !== "dict") throw Error("dictionary slot requires dictionary storage");
        if (name === "__len__") return values.integer(receiver.items.size);
        if (name === "__iter__") return values.iterator(runtimeIterate(receiver, values, meter));
        if (name === "__repr__") return runtimeNativeRepresentation(receiver, name, values, meter, invocation);
        runtimeDictionaryAccess(receiver, positional[0], name === "__setitem__" ? { kind: "set", value: positional[1] } : { kind: "delete" }, meter);
        return values.none;
      }
    }));
  }
  for (const [name, doc] of [["__contains__", "True if the dictionary has the specified key, else False."], ["__getitem__", "Return self[key]."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "dict",
      invoke(receiver, positional, keywords, meter) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `dict.${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `dict.${name}() takes exactly one argument (${positional.length} given)`);
        if (receiver.kind !== "dict") throw Error("dictionary slot requires dictionary storage");
        return name === "__contains__" ? values.boolean(runtimeDictionaryAccess(receiver, positional[0], "contains", meter)) : runtimeDictionaryAccess(receiver, positional[0], "get", meter);
      }
    }));
  }
}

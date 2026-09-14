import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonKeyError, runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { runtimeDictionaryPayload } from "./runtime-dictionary-payload.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Native dictionary protocols use one storage operation per key access;
 * owned subclasses consult __missing__ only after a failed item lookup. */
export function installRuntimeDictionarySlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 256);
  owner.value.namespace.items.set(values.string("__hash__"), values.none);
  for (const [name, doc] of [["__len__", "Return len(self)."], ["__iter__", "Implement iter(self)."],
    ["__repr__", "Return repr(self)."], ["__setitem__", "Set self[key] to value."], ["__delitem__", "Delete self[key]."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: receiver => runtimeDictionaryPayload(receiver) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        const count = name === "__setitem__" ? 2 : name === "__delitem__" ? 1 : 0;
        if (positional.length !== count) throw new PythonRuntimeError("TypeError", `${name === "__setitem__" ? "__setitem__ " : ""}expected ${count} argument${count === 1 ? "" : "s"}, got ${positional.length}`);
        const payload = runtimeDictionaryPayload(receiver);
        if (payload === undefined) throw Error("dictionary slot requires dictionary storage");
        if (name === "__len__") return values.integer(payload.items.size);
        if (name === "__iter__") return values.iterator(runtimeIterate(payload, values, meter));
        if (name === "__repr__") return runtimeNativeRepresentation(payload, name, values, meter, invocation);
        runtimeDictionaryAccess(payload, positional[0], name === "__setitem__" ? { kind: "set", value: positional[1] } : { kind: "delete" }, meter);
        return values.none;
      }
    }));
  }
  for (const [name, doc] of [["__contains__", "True if the dictionary has the specified key, else False."], ["__getitem__", "Return self[key]."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, textSignature: "($self, key, /)", accepts: receiver => runtimeDictionaryPayload(receiver) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation, bound) {
        meter.checkpoint();
        const typeName = bound && receiver.kind === "instance" ? receiver.type.value.name : "dict";
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${diagnosticTypeName(typeName, meter)}.${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `${diagnosticTypeName(typeName, meter)}.${name}() takes exactly one argument (${positional.length} given)`);
        const payload = runtimeDictionaryPayload(receiver);
        if (payload === undefined) throw Error("dictionary slot requires dictionary storage");
        if (name === "__contains__") return values.boolean(runtimeDictionaryAccess(payload, positional[0], "contains", meter));
        const found = runtimeDictionaryAccess(payload, positional[0], "lookup", meter);
        if (found !== undefined) return found.value;
        if (receiver.kind === "instance") {
          const missing = invocation?.lookupSpecial?.(receiver, "__missing__"); meter.checkpoint();
          if (missing !== undefined) return invocation!.call(missing, [positional[0]]);
        }
        throw new PythonKeyError(positional[0], meter);
      }
    }));
  }
}

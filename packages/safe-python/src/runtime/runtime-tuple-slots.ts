import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import { createRuntimeTupleMethod } from "./runtime-tuple-method.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Canonical tuple protocols retain immutable slot identity while delegating
 * member operations to the current execution's guest policies. */
export function installRuntimeTupleSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 256);
  for (const [name, doc] of [["__len__", "Return len(self)."], ["__iter__", "Implement iter(self)."], ["__contains__", "Return bool(key in self)."],
    ["__getitem__", "Return self[key]."], ["__repr__", "Return repr(self)."], ["__hash__", "Return hash(self)."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "tuple",
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        const count = name === "__contains__" || name === "__getitem__" ? 1 : 0;
        if (positional.length !== count) throw new PythonRuntimeError("TypeError", `expected ${count} argument${count === 1 ? "" : "s"}, got ${positional.length}`);
        if (receiver.kind !== "tuple") throw Error("tuple slot requires tuple storage");
        if (name === "__len__") return values.integer(receiver.items.length);
        if (name === "__iter__") return values.iterator(runtimeIterate(receiver, values, meter));
        if (name === "__getitem__") return runtimeIndex(receiver, positional[0], values, meter, invocation?.integerIndex);
        if (name === "__contains__") return runtimeMembership("in", positional[0], receiver, values, meter, undefined, invocation);
        if (name === "__repr__") return runtimeNativeRepresentation(receiver, name, values, meter, invocation);
        if (invocation?.nativeHash === undefined) throw Error("tuple hashing requires a native hash policy");
        let hash: bigint;
        try { hash = invocation.nativeHash(receiver); }
        catch (error) { throw error instanceof RuntimeHashError ? error.original : error; }
        meter.checkpoint(); return values.integer(hash);
      }
    }));
  }
  for (const [name, doc] of [["count", "Return number of occurrences of value."], ["index", "Return first index of value.\n\nRaises ValueError if the value is not present."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "tuple",
      invoke(receiver, positional, keywords, meter, invocation) {
        if (receiver.kind !== "tuple") throw Error("tuple method requires tuple storage");
        const method = createRuntimeTupleMethod(receiver, name, values, meter, invocation);
        return method.value.invoke(positional, keywords, meter, invocation);
      }
    }));
  }
}

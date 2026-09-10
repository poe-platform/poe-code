import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeMembership } from "./runtime-membership.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import { createRuntimeTupleMethod } from "./runtime-tuple-method.js";
import { runtimeTuplePayload } from "./runtime-tuple-payload.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Canonical tuple protocols retain immutable slot identity while delegating
 * member operations to the current execution's guest policies. */
export function installRuntimeTupleSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 256);
  for (const [name, doc] of [["__len__", "Return len(self)."], ["__iter__", "Implement iter(self)."], ["__contains__", "Return bool(key in self)."],
    ["__getitem__", "Return self[key]."], ["__repr__", "Return repr(self)."], ["__hash__", "Return hash(self)."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: receiver => runtimeTuplePayload(receiver) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        const count = name === "__contains__" || name === "__getitem__" ? 1 : 0;
        if (positional.length !== count) throw new PythonRuntimeError("TypeError", `expected ${count} argument${count === 1 ? "" : "s"}, got ${positional.length}`);
        const payload = runtimeTuplePayload(receiver);
        if (payload === undefined) throw Error("tuple slot requires tuple storage");
        if (name === "__len__") return values.integer(payload.items.length);
        if (name === "__iter__") return values.iterator(runtimeIterate(payload, values, meter));
        if (name === "__getitem__") {
          const result = runtimeIndex(payload, positional[0], values, meter, invocation?.integerIndex);
          return receiver.kind === "instance" && positional[0].kind === "slice" && result === payload ? values.tuple(payload.items) : result;
        }
        if (name === "__contains__") return runtimeMembership("in", positional[0], payload, values, meter, undefined, invocation);
        if (name === "__repr__") return runtimeNativeRepresentation(payload, name, values, meter, invocation);
        if (invocation?.nativeHash === undefined) throw Error("tuple hashing requires a native hash policy");
        let hash: bigint;
        try { hash = invocation.nativeHash(payload); }
        catch (error) { throw error instanceof RuntimeHashError ? error.original : error; }
        meter.checkpoint(); return values.integer(hash);
      }
    }));
  }
  for (const [name, doc] of [["count", "Return number of occurrences of value."], ["index", "Return first index of value.\n\nRaises ValueError if the value is not present."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, accepts: receiver => runtimeTuplePayload(receiver) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation) {
        const payload = runtimeTuplePayload(receiver);
        if (payload === undefined) throw Error("tuple method requires tuple storage");
        const method = createRuntimeTupleMethod(payload, name, values, meter, invocation);
        return method.value.invoke(positional, keywords, meter, invocation);
      }
    }));
  }
}

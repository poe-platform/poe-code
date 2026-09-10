import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import { runtimeSetAccess } from "./runtime-set.js";
import { createSetInitWrapper } from "./builtin-set-init.js";
import { runtimeSetPayload } from "./runtime-set-payload.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Exact set storage slots; native membership uses cached hashes and the
 * execution's live guest key policy, including mutable-set probe conversion. */
export function installRuntimeSetSlots(kind: "set" | "frozenset", owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  const names = [["__repr__", "Return repr(self)."], ["__len__", "Return len(self)."], ["__iter__", "Implement iter(self)."]];
  meter.checkpoint(0, 192);
  if (kind === "frozenset") names.push(["__hash__", "Return hash(self)."]);
  else {
    owner.value.namespace.items.set(values.string("__hash__"), values.none);
    owner.value.namespace.items.set(values.string("__init__"), createSetInitWrapper(owner, values, meter));
  }
  for (const [name, doc] of names) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: receiver => runtimeSetPayload(receiver)?.kind === kind,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
        const payload = runtimeSetPayload(receiver);
        if (payload === undefined) throw Error("set slot requires set storage");
        if (name === "__repr__") {
          if (invocation?.nativeSetRepr !== undefined) return invocation.nativeSetRepr(receiver);
          if (receiver.kind === "instance") throw Error("set subclass repr requires an active representation policy");
          return runtimeNativeRepresentation(payload, "__repr__", values, meter, invocation);
        }
        if (name === "__len__") return values.integer(payload.items.size);
        if (name === "__hash__") return values.integer(payload.items.keySetHash());
        meter.checkpoint(0, 32);
        return values.iterator(payload.items.iterate(key => key, "set"));
      }
    }));
  }
  meter.checkpoint(0, 96);
  owner.value.namespace.items.set(values.string("__contains__"), values.methodDescriptor({ owner, name: "__contains__", doc: "x.__contains__(y) <==> y in x.", accepts: receiver => runtimeSetPayload(receiver)?.kind === kind,
    invoke(receiver, positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${kind}.__contains__() takes no keyword arguments`);
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `${kind}.__contains__() takes exactly one argument (${positional.length} given)`);
      const payload = runtimeSetPayload(receiver);
      if (payload === undefined) throw Error("set membership requires set storage");
      return values.boolean(runtimeSetAccess(payload, positional[0], "contains", values, meter));
    }
  }));
}

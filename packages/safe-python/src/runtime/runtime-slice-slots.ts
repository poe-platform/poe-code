import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import { installRuntimeComparisonMethods } from "./runtime-native-comparison-method.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import { integerIndex } from "./index-protocol.js";
import { normalizeSlice } from "./integer-sequence.js";
import { runtimeSliceBounds } from "./runtime-slice-bounds.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Immutable slice components are native member descriptors, not properties. */
export function installRuntimeSliceSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  installRuntimeComparisonMethods("slice", owner, values, meter);
  for (const name of ["start", "stop", "step"] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.memberDescriptor({ owner, name, accepts: receiver => receiver.kind === "slice",
      get(receiver, meter) {
        meter.checkpoint();
        if (receiver.kind !== "slice") throw Error("slice member requires slice storage");
        return receiver[name];
      }
    }));
  }
  owner.value.namespace.items.set(values.string("__repr__"), values.wrapperDescriptor({ owner, name: "__repr__", doc: "Return repr(self).", accepts: receiver => receiver.kind === "slice",
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __repr__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (receiver.kind !== "slice") throw Error("slice repr requires slice storage");
      return runtimeNativeRepresentation(receiver, "__repr__", values, meter, invocation);
    }
  }));
  owner.value.namespace.items.set(values.string("__hash__"), values.wrapperDescriptor({ owner, name: "__hash__", doc: "Return hash(self).", accepts: receiver => receiver.kind === "slice",
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __hash__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (invocation?.nativeHash === undefined) throw Error("slice hashing requires a native hash policy");
      let hash: bigint;
      try { hash = invocation.nativeHash(receiver); }
      catch (error) { throw error instanceof RuntimeHashError ? error.original : error; }
      meter.checkpoint(); return values.integer(hash);
    }
  }));
  for (const [name, doc] of [["indices", "S.indices(len) -> (start, stop, stride)\n\nAssuming a sequence of length len, calculate the start and stop\nindices, and the stride length of the extended slice described by\nS. Out of bounds indices are clipped in a manner consistent with the\nhandling of normal slices."], ["__reduce__", "Return state information for pickling."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "slice",
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `slice.${name}() takes no keyword arguments`);
        const count = name === "indices" ? 1 : 0;
        if (positional.length !== count) throw new PythonRuntimeError("TypeError", `slice.${name}() takes ${count === 1 ? "exactly one argument" : "no arguments"} (${positional.length} given)`);
        if (receiver.kind !== "slice") throw Error("slice method requires slice storage");
        if (name === "__reduce__") return values.tuple([owner, values.tuple([receiver.start, receiver.stop, receiver.step])]);
        if (invocation?.integerIndex === undefined) throw Error("slice indices requires an integer index policy");
        const length = integerIndex(positional[0], invocation.integerIndex, meter);
        if (length < 0n) throw new PythonRuntimeError("ValueError", "length should not be negative");
        const bounds = runtimeSliceBounds(receiver, meter, invocation.integerIndex);
        const indices = normalizeSlice(length, bounds.start, bounds.stop, bounds.step);
        return values.tuple([values.integer(indices.start), values.integer(indices.stop), values.integer(indices.step)]);
      }
    }));
  }
}

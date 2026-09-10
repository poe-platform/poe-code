import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import type { NativeBoundCallableKind } from "./runtime-bound-comparison-method.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Explicit callable hash slots use native binding storage, not object identity.
 * Nested function hashing remains guest-aware; the outer slot is not reentered. */
export function createBoundCallableHashWrapper(kind: NativeBoundCallableKind, owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner, name: "__hash__", doc: "Return hash(self).", accepts: receiver => receiver.kind === kind,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __hash__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (invocation?.nativeHash === undefined) throw Error("native callable hashing requires a native hash policy");
      let result: bigint;
      try { result = invocation.nativeHash(receiver); }
      catch (error) { throw error instanceof RuntimeHashError ? error.original : error; }
      meter.checkpoint(); return values.integer(result);
    }
  });
}

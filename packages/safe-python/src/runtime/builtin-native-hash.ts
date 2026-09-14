import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError,type ExecutionMeter } from "./execution-budget.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import type { NativeBoundCallableKind } from "./runtime-native-comparison-method.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Explicit native slots share execution hashing without reentering the outer
 * descriptor. Nested callable hashing remains guest-aware. */
export function createNativeHashWrapper(kind: NativeBoundCallableKind|"none", owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner, name: "__hash__", textSignature: "($self, /)", doc: "Return hash(self).", accepts: receiver => receiver.kind === kind,
    invoke(receiver, positional, keywords, meter, invocation) {
      let fatal=false;
      try {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __hash__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (invocation?.nativeHash === undefined) throw Error("native slot hashing requires a native hash policy");
      let result: bigint;
      try { result = invocation.nativeHash(receiver); }
      catch (error) { throw error instanceof RuntimeHashError ? error.original : error; }
      meter.checkpoint(); return values.integer(result);
      } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
      finally{if(!fatal)meter.checkpoint();}
    }
  });
}

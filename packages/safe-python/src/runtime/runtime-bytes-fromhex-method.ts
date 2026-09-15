import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { BuiltinFunctionValue, RuntimeValues } from "./runtime-values.js";

// The pinned release writer reserves floor(input length / 2) bytes. Once that
// exceeds its inline buffer, finishing a one-byte output preserves fresh heap
// identity. Whitespace still contributes to the reservation; empty is canonical.
const bytesWriterInlineCapacity=512;

/** Exact bytes class operation; subclass constructors remain object-model work. */
export function createRuntimeBytesFromhexMethod(values: RuntimeValues, meter: ExecutionMeter, buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "fromhex",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "bytes.fromhex() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `bytes.fromhex() takes exactly one argument (${positional.length} given)`);
      const source = positional[0];
      const payload=runtimeStringPayload(source)??runtimeBytesPayload(source);
      if(payload!==undefined){
        const result=ImmutableBytes.fromHex(payload.value,meter);
        return values.bytes(result,result.length!==0&&Math.floor(payload.value.length/2)>bytesWriterInlineCapacity?"fresh":"canonical");
      }
      let lease: RuntimeBufferLease | undefined;
      try {
        lease = buffers?.acquireSimple(source); meter.checkpoint();
        if (lease === undefined) {
          const nativeType = source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind;
          const type = buffers?.typeName === undefined ? nativeType : diagnosticTypeName(buffers.typeName(source), meter);
          throw new PythonRuntimeError("TypeError", `fromhex() argument must be str or bytes-like, not ${type}`);
        }
        const storage = lease.copy(); meter.checkpoint();
        const result=ImmutableBytes.fromHex(storage,meter);
        return values.bytes(result,result.length!==0&&Math.floor(storage.length/2)>bytesWriterInlineCapacity?"fresh":"canonical");
      } finally {
        lease?.release(); meter.checkpoint();
      }
    }
  });
}

import {bindRuntimeClinicArguments} from "./runtime-clinic-arguments.js";
import {unsupportedBuffer} from "./runtime-buffer-error.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesTranslateMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, values: RuntimeValues, meter: ExecutionMeter, buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "translate",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 2) throw new PythonRuntimeError("TypeError", `translate() takes at most 2 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "translate() takes at least 1 positional argument (0 given)");
      const [,deleted]=bindRuntimeClinicArguments("translate",["","delete"],positional,keywords,values,meter,invocation);
      const source = positional[0];
      let tableLease: RuntimeBufferLease | undefined, deletionLease: RuntimeBufferLease | undefined;
      try {
        if (source.kind !== "none" && source.kind !== "bytes") {
          tableLease = buffers?.acquireSimple(source); meter.checkpoint();
          if (tableLease === undefined) unsupportedBuffer(source,meter,buffers);
        }
        const length = source.kind === "none" ? null : source.kind === "bytes" ? source.value.length : tableLease!.byteLength;
        if (length !== null && length !== 256) throw new PythonRuntimeError("ValueError", "translation table must be 256 characters long");
        if (deleted !== undefined && deleted.kind !== "bytes") {
          deletionLease = buffers?.acquireSimple(deleted); meter.checkpoint();
          if (deletionLease === undefined) unsupportedBuffer(deleted,meter,buffers);
        }
        const table = source.kind === "none" ? null : source.kind === "bytes" ? source.value : tableLease!.copy();
        meter.checkpoint();
        const deletion = deleted === undefined ? null : deleted.kind === "bytes" ? deleted.value : deletionLease!.copy();
        meter.checkpoint();
        const result = receiver.value.translate(table, deletion, meter);
        return result === receiver.value ? receiver : values.bytes(result, result.length === 0 ? "canonical" : "fresh");
      } finally {
        try { tableLease?.release(); } finally { deletionLease?.release(); }
        meter.checkpoint();
      }
    }
  });
}

import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesTranslateMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, values: RuntimeValues, meter: ExecutionMeter, buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "translate",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 2) throw new PythonRuntimeError("TypeError", `translate() takes at most 2 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "translate() takes at least 1 positional argument (0 given)");
      let deleted = positional[1];
      for (const [key, value] of keywords.items.snapshot()) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label !== "delete") throw new PythonRuntimeError("TypeError", `translate() got an unexpected keyword argument '${label}'`);
        deleted = value;
      }
      const source = positional[0];
      let tableLease: RuntimeBufferLease | undefined, deletionLease: RuntimeBufferLease | undefined;
      try {
        if (source.kind !== "none" && source.kind !== "bytes") {
          tableLease = buffers?.acquireSimple(source); meter.checkpoint();
          if (tableLease === undefined) translationBytesArgument(source);
        }
        const length = source.kind === "none" ? null : source.kind === "bytes" ? source.value.length : tableLease!.byteLength;
        if (length !== null && length !== 256) throw new PythonRuntimeError("ValueError", "translation table must be 256 characters long");
        if (deleted !== undefined && deleted.kind !== "bytes") {
          deletionLease = buffers?.acquireSimple(deleted); meter.checkpoint();
          if (deletionLease === undefined) translationBytesArgument(deleted);
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

function translationBytesArgument(value: RuntimeValue): never {
  const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
  throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${type}'`);
}

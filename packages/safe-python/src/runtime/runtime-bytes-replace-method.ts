import {unsupportedBuffer} from "./runtime-buffer-error.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeSizeIndex } from "./runtime-size-index.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesReplaceMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>, buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "replace",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "bytes.replace() takes no keyword arguments");
      if (positional.length < 2) throw new PythonRuntimeError("TypeError", `replace expected at least 2 arguments, got ${positional.length}`);
      if (positional.length > 3) throw new PythonRuntimeError("TypeError", `replace expected at most 3 arguments, got ${positional.length}`);
      const old = positional[0], replacement = positional[1];
      let oldLease: RuntimeBufferLease | undefined, replacementLease: RuntimeBufferLease | undefined;
      try {
        if (old.kind !== "bytes") {
          oldLease = buffers?.acquireSimple(old); meter.checkpoint();
          if (oldLease === undefined) unsupportedBuffer(old,meter,buffers);
        }
        if (replacement.kind !== "bytes") {
          replacementLease = buffers?.acquireSimple(replacement); meter.checkpoint();
          if (replacementLease === undefined) unsupportedBuffer(replacement,meter,buffers);
        }
        const count = positional[2] === undefined ? -1n : runtimeSizeIndex(positional[2], meter, context);
        const oldBytes = old.kind === "bytes" ? old.value : oldLease!.copy(); meter.checkpoint();
        const replacementBytes = replacement.kind === "bytes" ? replacement.value : replacementLease!.copy(); meter.checkpoint();
        const result = receiver.value.replace(oldBytes, replacementBytes, count, meter);
        return result === receiver.value ? receiver : values.bytes(result, result.length === 0 ? "canonical" : "fresh");
      } finally {
        try { oldLease?.release(); } finally { replacementLease?.release(); }
        meter.checkpoint();
      }
    }
  });
}

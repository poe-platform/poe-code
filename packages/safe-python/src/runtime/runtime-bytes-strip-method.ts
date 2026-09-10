import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesStripMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, name: "strip" | "lstrip" | "rstrip", values: RuntimeValues, meter: ExecutionMeter, buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes no keyword arguments`);
      if (positional.length > 1) throw new PythonRuntimeError("TypeError", `${name} expected at most 1 argument, got ${positional.length}`);
      const chars = positional[0];
      let lease: RuntimeBufferLease | undefined;
      try {
        if (chars !== undefined && chars.kind !== "none" && chars.kind !== "bytes") {
          lease = buffers?.acquireSimple(chars); meter.checkpoint();
          if (lease === undefined) {
            const type = chars.kind === "not-implemented" ? "NotImplementedType" : chars.kind;
            throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${type}'`);
          }
        }
        const storage = chars?.kind === "bytes" ? chars.value : lease?.copy() ?? null;
        meter.checkpoint();
        const result = receiver.value.strip(name, storage, meter);
        return result === receiver.value ? receiver : values.bytes(result);
      } finally {
        lease?.release();
        meter.checkpoint();
      }
    }
  });
}

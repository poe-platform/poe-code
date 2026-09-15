import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeSearchBound } from "./runtime-search-bound.js";
import {runtimeTuplePayload} from "./runtime-tuple-payload.js";
import {unsupportedBuffer} from "./runtime-buffer-error.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Tuple alternatives are checked lazily after bound conversion. Unlike byte
 * searches, these methods do not accept integer needles. */
export function createRuntimeBytesAffixMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, name: "startswith" | "endswith", values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>, buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes no keyword arguments`);
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", `${name} expected at least 1 argument, got 0`);
      if (positional.length > 3) throw new PythonRuntimeError("TypeError", `${name} expected at most 3 arguments, got ${positional.length}`);
      const start = runtimeSearchBound(positional[1], 0n, meter, true, context), stop = runtimeSearchBound(positional[2], 9223372036854775807n, meter, true, context);
      const candidate = positional[0], tuple = runtimeTuplePayload(candidate);
      meter.checkpoint(1, 64);
      const matches = (value: RuntimeValue): boolean => {
        meter.checkpoint();
        let lease: RuntimeBufferLease | undefined;
        try {
          if (value.kind !== "bytes") {
            lease = buffers?.acquireSimple(value); meter.checkpoint();
            if (lease === undefined) {
              if(tuple!==undefined)unsupportedBuffer(value,meter,buffers);
              const type = buffers?.typeName?.(value)??(value.kind === "instance" ? value.type.value.diagnosticName : value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
              throw new PythonRuntimeError("TypeError", `${name} first arg must be bytes or a tuple of bytes, not ${type}`);
            }
          }
          const storage = value.kind === "bytes" ? value.value : lease!.copy(); meter.checkpoint();
          return receiver.value.hasAffix(storage, name === "startswith" ? "start" : "end", start, stop, meter);
        } finally {
          lease?.release(); meter.checkpoint();
        }
      };
      if (!tuple) return values.boolean(matches(candidate));
      for (const value of tuple.items) if (matches(value)) return values.true;
      return values.false;
    }
  });
}

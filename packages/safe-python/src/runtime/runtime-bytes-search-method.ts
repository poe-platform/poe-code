import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import { runtimeSearchBound } from "./runtime-search-bound.js";
import { validateIndexResult, type IntegerIndexContext } from "./index-protocol.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesSearchMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, name: "find" | "rfind" | "index" | "rindex" | "count", values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>, buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes no keyword arguments`);
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", `${name} expected at least 1 argument, got 0`);
      if (positional.length > 3) throw new PythonRuntimeError("TypeError", `${name} expected at most 3 arguments, got ${positional.length}`);
      const start = runtimeSearchBound(positional[1], 0n, meter, true, context), stop = runtimeSearchBound(positional[2], 9223372036854775807n, meter, true, context);
      const needle = positional[0];
      let lease: RuntimeBufferLease | undefined;
      try {
        if (needle.kind !== "bytes" && needle.kind !== "int" && needle.kind !== "bool") {
          lease = buffers?.acquireSimple(needle); meter.checkpoint();
        }
        let pattern: ImmutableBytes | number;
        if (needle.kind === "bytes") pattern = needle.value;
        else if (lease !== undefined) { pattern = lease.copy(); meter.checkpoint(); }
        else {
          let byte = needle.kind === "int" ? needle.value : needle.kind === "bool" ? (needle.value ? 1n : 0n) : context?.integer(needle);
          if (byte === undefined && context !== undefined) {
            const slot = context.lookupIndex(needle);
            meter.checkpoint();
            if (slot !== undefined) byte = context.integer(validateIndexResult(slot(), context, meter));
          }
          meter.checkpoint();
          if (byte === undefined) {
            const type = context === undefined ? needle.kind === "none" ? "NoneType" : needle.kind === "not-implemented" ? "NotImplementedType" : needle.kind : diagnosticTypeName(context.typeName(needle), meter);
            throw new PythonRuntimeError("TypeError", `argument should be integer or bytes-like object, not '${type}'`);
          }
          if (byte < 0n || byte > 255n) throw new PythonRuntimeError("ValueError", "byte must be in range(0, 256)");
          pattern = Number(byte);
        }
        const mode = name === "index" ? "find" : name === "rindex" ? "rfind" : name;
        const index = receiver.value.search(pattern, mode, start, stop, meter);
        if (index === -1 && (name === "index" || name === "rindex")) throw new PythonRuntimeError("ValueError", "subsection not found");
        return values.integer(index);
        } finally {
          lease?.release(); meter.checkpoint();
      }
    }
  });
}

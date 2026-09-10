import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Static byte operation: accessing it through an instance does not bind self. */
export function createRuntimeBytesMaketransMethod(values: RuntimeValues, meter: ExecutionMeter, buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "maketrans",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "bytes.maketrans() takes no keyword arguments");
      if (positional.length !== 2) throw new PythonRuntimeError("TypeError", `maketrans expected 2 arguments, got ${positional.length}`);
      const from = positional[0], to = positional[1];
      let fromLease: RuntimeBufferLease | undefined, toLease: RuntimeBufferLease | undefined;
      try {
        if (from.kind !== "bytes") {
          fromLease = buffers?.acquireSimple(from); meter.checkpoint();
          if (fromLease === undefined) translationBytesArgument(from);
        }
        if (to.kind !== "bytes") {
          toLease = buffers?.acquireSimple(to); meter.checkpoint();
          if (toLease === undefined) translationBytesArgument(to);
        }
        const fromLength = from.kind === "bytes" ? from.value.length : fromLease!.byteLength;
        const toLength = to.kind === "bytes" ? to.value.length : toLease!.byteLength;
        if (fromLength !== toLength) throw new PythonRuntimeError("ValueError", "maketrans arguments must have same length");
        const fromBytes = from.kind === "bytes" ? from.value : fromLease!.copy(); meter.checkpoint();
        const toBytes = to.kind === "bytes" ? to.value : toLease!.copy(); meter.checkpoint();
        return values.bytes(ImmutableBytes.maketrans(fromBytes, toBytes, meter));
      } finally {
        try { fromLease?.release(); } finally { toLease?.release(); }
        meter.checkpoint();
      }
    }
  });
}

function translationBytesArgument(value: RuntimeValue): never {
  const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
  throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${type}'`);
}

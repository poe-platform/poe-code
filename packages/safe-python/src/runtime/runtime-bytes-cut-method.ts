import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Boundary removal and single-separator partitioning over owned byte storage.
 * Unchanged results retain the receiver; a matched separator is retained. */
export function createRuntimeBytesCutMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, name: "removeprefix" | "removesuffix" | "partition" | "rpartition", values: RuntimeValues, meter: ExecutionMeter, buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes no keyword arguments`);
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `bytes.${name}() takes exactly one argument (${positional.length} given)`);
      const argument = positional[0], source = receiver.value;
      let lease: RuntimeBufferLease | undefined;
      try {
        if (argument.kind !== "bytes") {
          lease = buffers?.acquireSimple(argument); meter.checkpoint();
          if (lease === undefined) invalidBytesArgument(argument);
        }
        const separator = argument.kind === "bytes" ? argument.value : lease!.copy();
        meter.checkpoint();
        if (name === "removeprefix" || name === "removesuffix") {
          if (separator.length === 0 || !source.hasAffix(separator, name === "removeprefix" ? "start" : "end", 0n, null, meter)) return receiver;
          const start = name === "removeprefix" ? BigInt(separator.length) : 0n;
          const stop = name === "removesuffix" ? BigInt(source.length - separator.length) : null;
          return values.bytes(source.slice(start, stop, null, meter));
        }
        if (separator.length === 0) throw new PythonRuntimeError("ValueError", "empty separator");
        const index = source.search(separator, name === "partition" ? "find" : "rfind", 0n, null, meter);
        if (index === -1) {
          const empty = values.bytes(new Uint8Array());
          return values.tuple(name === "partition" ? [receiver, empty, empty] : [empty, empty, receiver]);
        }
        const left = values.bytes(source.slice(0n, BigInt(index), null, meter)), end = index + separator.length;
        const right = index === 0 && end === source.length ? left : values.bytes(source.slice(BigInt(end), null, null, meter));
        return values.tuple([left, lease?.object ?? argument, right]);
      } finally {
        lease?.release(); meter.checkpoint();
      }
    }
  });
}

function invalidBytesArgument(value: RuntimeValue): never {
  const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
  throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${type}'`);
}

import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import type { BuiltinFunctionValue, RuntimeValues } from "./runtime-values.js";

/** Exact bytes class operation; subclass constructors remain object-model work. */
export function createRuntimeBytesFromhexMethod(values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "fromhex",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "bytes.fromhex() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `bytes.fromhex() takes exactly one argument (${positional.length} given)`);
      const source = positional[0];
      if (source.kind !== "str" && source.kind !== "bytes") {
        const type = source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind;
        throw new PythonRuntimeError("TypeError", `fromhex() argument must be str or bytes-like, not ${type}`);
      }
      return values.bytes(ImmutableBytes.fromHex(source.value, meter));
    }
  });
}

import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Static byte operation: accessing it through an instance does not bind self. */
export function createRuntimeBytesMaketransMethod(values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "maketrans",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "bytes.maketrans() takes no keyword arguments");
      if (positional.length !== 2) throw new PythonRuntimeError("TypeError", `maketrans expected 2 arguments, got ${positional.length}`);
      const from = translationBytesArgument(positional[0]), to = translationBytesArgument(positional[1]);
      return values.bytes(ImmutableBytes.maketrans(from.value, to.value, meter));
    }
  });
}

function translationBytesArgument(value: RuntimeValue): Extract<RuntimeValue, { kind: "bytes" }> {
  if (value.kind === "bytes") return value;
  const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
  throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${type}'`);
}

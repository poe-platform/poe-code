import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Exact-value length without iteration. Generic object slots remain separate. */
export function runtimeLength(value: RuntimeValue, meter: ExecutionMeter): number | bigint {
  meter.checkpoint();
  switch (value.kind) {
    case "list": case "tuple": return value.items.length;
    case "dict": case "set": case "frozenset": return value.items.size;
    case "mappingproxy": case "dict_keys": case "dict_values": case "dict_items": return value.value.items.size;
    case "str": case "bytes": return value.value.length;
    case "range":
      if (BigInt.asIntN(64, value.value.length) !== value.value.length) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
      return value.value.length;
    default: {
      const name = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
      throw new PythonRuntimeError("TypeError", `object of type '${name}' has no len()`);
    }
  }
}

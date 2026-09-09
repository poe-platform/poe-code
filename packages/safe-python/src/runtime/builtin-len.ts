import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValues } from "./runtime-values.js";

/** Register explicitly in an execution's builtin namespace. Exact containers
 * read their length without traversal or guest callbacks. Generic __len__ slots
 * remain part of the wider object model; values and capability share one meter.
 */
export function createLenBuiltin(values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "len",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "len() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `len() takes exactly one argument (${positional.length} given)`);
      const value = positional[0];
      let length: number | bigint;
      switch (value.kind) {
        case "list": case "tuple": length = value.items.length; break;
        case "dict": case "set": case "frozenset": length = value.items.size; break;
        case "mappingproxy": case "dict_keys": case "dict_values": case "dict_items": length = value.value.items.size; break;
        case "str": case "bytes": length = value.value.length; break;
        case "range":
          length = value.value.length;
          if (BigInt.asIntN(64, length) !== length) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
          break;
        default: {
          const name = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
          throw new PythonRuntimeError("TypeError", `object of type '${name}' has no len()`);
        }
      }
      return values.integer(length);
    }
  });
}

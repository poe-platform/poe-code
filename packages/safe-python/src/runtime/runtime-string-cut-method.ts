import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact boundary removal and single-separator partitioning. Unchanged text
 * retains receiver identity; partition results retain the supplied separator. */
export function createRuntimeStringCutMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, name: "removeprefix" | "removesuffix" | "partition" | "rpartition", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no keyword arguments`);
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `str.${name}() takes exactly one argument (${positional.length} given)`);
      const argument = positional[0], remove = name === "removeprefix" || name === "removesuffix";
      if (argument.kind !== "str") {
        const type = argument.kind === "none" ? (remove ? "None" : "NoneType") : argument.kind === "not-implemented" ? "NotImplementedType" : argument.kind;
        throw new PythonRuntimeError("TypeError", remove ? `${name}() argument must be str, not ${type}` : `must be str, not ${type}`);
      }
      const text = receiver.value, separator = argument.value;
      if (remove) {
        if (separator.length === 0 || !text.hasAffix(separator, name === "removeprefix" ? "start" : "end", 0n, null, meter)) return receiver;
        const start = name === "removeprefix" ? BigInt(separator.length) : 0n;
        const stop = name === "removesuffix" ? BigInt(text.length - separator.length) : null;
        return values.stringPoints(text.slice(start, stop, null, meter), "canonical");
      }
      if (separator.length === 0) throw new PythonRuntimeError("ValueError", "empty separator");
      const index = text.search(separator, name === "partition" ? "find" : "rfind", 0n, null, meter);
      if (index === -1) {
        const empty = values.string("");
        return values.tuple(name === "partition" ? [receiver, empty, empty] : [empty, empty, receiver]);
      }
      const left = index === 0 ? values.string("") : values.stringPoints(text.slice(0n, BigInt(index), null, meter), "canonical");
      const end = index + separator.length;
      const right = end === text.length ? (index === 0 ? left : values.string("")) : values.stringPoints(text.slice(BigInt(end), null, null, meter), "canonical");
      return values.tuple([left, argument, right]);
    }
  });
}

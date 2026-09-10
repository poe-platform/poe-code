import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Explicit exact-builtin iteration slots. Guest protocol dispatch and native
 * method-wrapper type/introspection are separate from these callable bindings. */
export function readRuntimeIteratorMethod(receiver: RuntimeValue, name: string, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue | undefined {
  if (name !== "__iter__" && name !== "__next__" && name !== "__length_hint__") return undefined;
  if (name === "__length_hint__") {
    if (receiver.kind !== "iterator" || receiver.value.lengthHint === undefined) return undefined;
  } else if (name === "__next__") {
    if (receiver.kind !== "iterator") return undefined;
  } else {
    switch (receiver.kind) {
      case "list": case "tuple": case "str": case "bytes": case "range":
      case "dict": case "mappingproxy": case "dict_keys": case "dict_values":
      case "dict_items": case "set": case "frozenset": case "iterator": break;
      default: return undefined;
    }
  }
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (name === "__length_hint__" && receiver.kind === "iterator") {
        const hint = receiver.value.lengthHint!(); meter.checkpoint();
        return hint === undefined ? values.notImplemented : values.integer(hint);
      }
      if (name === "__iter__") return receiver.kind === "iterator" ? receiver : values.iterator(runtimeIterate(receiver, values, meter));
      // Eligibility above ensures that only a prepared cursor reaches this path.
      const step = runtimeIterate(receiver, values, meter).next();
      meter.checkpoint();
      if (step.done) {
        if (step.exception !== undefined) throw step.exception.value;
        throw new PythonRuntimeError("StopIteration", "");
      }
      return step.value;
    }
  });
}

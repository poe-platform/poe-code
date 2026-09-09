import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { BuiltinFunctionValue, ListValue, RuntimeValues } from "./runtime-values.js";

/** Exact list capabilities backed by owned, metered storage. Guest index slots,
 * iterable length hints, descriptors and finalizers belong to the object layer. */
export function createRuntimeListMethod(receiver: ListValue, name: "append" | "extend" | "insert" | "pop" | "clear" | "reverse" | "copy" | "count" | "remove", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `list.${name}() takes no keyword arguments`);
      if (name === "insert" || name === "pop") {
        if (name === "insert" && positional.length !== 2) throw new PythonRuntimeError("TypeError", `insert expected 2 arguments, got ${positional.length}`);
        if (name === "pop" && positional.length > 1) throw new PythonRuntimeError("TypeError", `pop expected at most 1 argument, got ${positional.length}`);
        const value = positional[0];
        let index = -1n;
        if (value !== undefined) {
          if (value.kind === "int") index = value.value;
          else if (value.kind === "bool") index = value.value ? 1n : 0n;
          else {
            const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
            throw new PythonRuntimeError("TypeError", `'${type}' object cannot be interpreted as an integer`);
          }
          if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
        }
        if (name === "pop") return receiver.items.pop(index);
        receiver.items.insert(index, positional[1]);
        return values.none;
      }
      if (name === "clear" || name === "reverse" || name === "copy") {
        if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `list.${name}() takes no arguments (${positional.length} given)`);
        if (name === "copy") return values.list(receiver.items.slice());
        if (name === "clear") receiver.items.clear();
        else receiver.items.reverse();
        return values.none;
      }
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `list.${name}() takes exactly one argument (${positional.length} given)`);
      const value = positional[0];
      if (name === "append") receiver.items.append(value);
      else if (name === "extend") {
        if (value.kind === "list") receiver.items.extend(value.items);
        else receiver.items.extendIterator(runtimeIterate(value, values, meter));
      } else {
        const equal = (a: typeof value, b: typeof value) => runtimeComparison("==", a, b, values, meter).value;
        if (name === "count") return values.integer(receiver.items.count(value, equal));
        if (!receiver.items.removeFirst(value, equal)) throw new PythonRuntimeError("ValueError", "list.remove(x): x not in list");
      }
      return values.none;
    }
  });
}

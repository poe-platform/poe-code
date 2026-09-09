import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { BuiltinFunctionValue, ListValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { runtimeSearchBound } from "./runtime-search-bound.js";
import { createRuntimeSearchEquality, type RuntimeSearchEqualityContext } from "./runtime-search-equality.js";

export type RuntimeListMethodContext = RuntimeSearchEqualityContext & Partial<Pick<ExpressionContext<RuntimeValue>, "iterate">>;

/** Exact list capabilities backed by owned, metered storage. Optional expression
 * capabilities supply guest iteration, equality and truth. Guest index slots,
 * descriptors and finalizers remain separate object-layer work. */
export function createRuntimeListMethod(receiver: ListValue, name: "append" | "extend" | "insert" | "pop" | "clear" | "reverse" | "copy" | "count" | "remove" | "index" | "__reversed__", values: RuntimeValues, meter: ExecutionMeter, context: RuntimeListMethodContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const equal = createRuntimeSearchEquality(values, meter, context);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `list.${name}() takes no keyword arguments`);
      if (name === "index") {
        if (positional.length < 1) throw new PythonRuntimeError("TypeError", "index expected at least 1 argument, got 0");
        if (positional.length > 3) throw new PythonRuntimeError("TypeError", `index expected at most 3 arguments, got ${positional.length}`);
        const start = runtimeSearchBound(positional[1], 0n, meter, false, context.integerIndex), stop = runtimeSearchBound(positional[2], 9223372036854775807n, meter, false, context.integerIndex);
        const index = receiver.items.indexOf(positional[0], equal, start, stop);
        if (index === undefined) throw new PythonRuntimeError("ValueError", "list.index(x): x not in list");
        return values.integer(index);
      }
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
      if (name === "clear" || name === "reverse" || name === "copy" || name === "__reversed__") {
        if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `list.${name}() takes no arguments (${positional.length} given)`);
        if (name === "__reversed__") return values.iterator(receiver.items.reversed());
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
        else receiver.items.extendIterator(context.iterate === undefined ? runtimeIterate(value, values, meter) : context.iterate(value, undefined, true));
      } else {
        if (name === "count") return values.integer(receiver.items.count(value, equal));
        if (!receiver.items.removeFirst(value, equal)) throw new PythonRuntimeError("ValueError", "list.remove(x): x not in list");
      }
      return values.none;
    }
  });
}

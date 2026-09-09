import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, ListValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Sort binding and callback bridge. Storage owns temporary-empty semantics
 * and restoration; the stable-sort kernel does not promise CPython's exact
 * comparison schedule or partial permutation after comparison failure. */
export function createRuntimeListSortMethod(receiver: ListValue, values: RuntimeValues, meter: ExecutionMeter, beginCall?: ExpressionContext<RuntimeValue>["beginCall"]): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "sort",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", "sort() takes no positional arguments");
      if (keywords.items.size > 2) throw new PythonRuntimeError("TypeError", `sort() takes at most 2 keyword arguments (${keywords.items.size} given)`);
      let key: RuntimeValue = values.none, reverse: RuntimeValue = values.false;
      for (const [name, value] of keywords.items.snapshot()) {
        if (name.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of name.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label === "key") key = value;
        else if (label === "reverse") reverse = value;
        else throw new PythonRuntimeError("TypeError", `sort() got an unexpected keyword argument '${label}'`);
      }
      const descending = runtimeTruth(reverse, meter);
      meter.checkpoint(1, 64);
      receiver.items.sort({
        reverse: descending,
        key(value) {
          if (key.kind === "none") return value;
          if (beginCall === undefined) throw new Error("sort key invocation requires a runtime call capability");
          const call = beginCall(key);
          meter.checkpoint();
          call.positional(value);
          meter.checkpoint();
          const result = call.invoke();
          meter.checkpoint();
          return result;
        },
        less: (a, b) => runtimeComparison("<", a, b, values, meter).value
      });
      return values.none;
    }
  });
}

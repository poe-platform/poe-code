import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { unexpectedBuiltinKeyword } from "./unexpected-builtin-keyword.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import type { BuiltinFunctionValue, ListValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Sort binding and callback bridge. Storage owns temporary-empty semantics
 * and restoration; the stable-sort kernel does not promise CPython's exact
 * comparison schedule or partial permutation after comparison failure. */
export function createRuntimeListSortMethod(receiver: ListValue, values: RuntimeValues, meter: ExecutionMeter, beginCall?: ExpressionContext<RuntimeValue>["beginCall"]): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "sort",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length !== 0 && positional.length + keywords.items.size > 2) throw new PythonRuntimeError("TypeError", `sort() takes at most 2 arguments (${positional.length + keywords.items.size} given)`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", "sort() takes no positional arguments");
      if (keywords.items.size > 2) throw new PythonRuntimeError("TypeError", `sort() takes at most 2 keyword arguments (${keywords.items.size} given)`);
      let key: RuntimeValue | undefined, reverse: RuntimeValue | undefined, unexpected = false;
      for (const [name, value] of keywords.items.snapshot()) {
        const payload = runtimeStringPayload(name);
        if (payload === undefined) throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of payload.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label === "key" && key === undefined) key = value;
        else if (label === "reverse" && reverse === undefined) reverse = value;
        else unexpected = true;
      }
      if (unexpected) unexpectedBuiltinKeyword("sort", keywords, ["key", "reverse"], values, meter, invocation);
      const descending = reverse === undefined ? false : invocation?.truth === undefined ? runtimeTruth(reverse, meter) : invocation.truth(reverse);
      meter.checkpoint(1, 64);
      receiver.items.sort({
        reverse: descending,
        key(value) {
          if (key === undefined || key.kind === "none") return value;
          if (beginCall === undefined) {
            if (invocation === undefined) throw new Error("sort key invocation requires a runtime call capability");
            meter.checkpoint(0, 8);
            const result = invocation.call(key, [value]); meter.checkpoint(); return result;
          }
          const call = beginCall(key);
          meter.checkpoint();
          call.positional(value);
          meter.checkpoint();
          const result = call.invoke();
          meter.checkpoint();
          return result;
        },
        less: (a, b) => invocation?.compareTruth === undefined ? runtimeComparison("<", a, b, values, meter).value : invocation.compareTruth("<", a, b)
      });
      return values.none;
    }
  });
}

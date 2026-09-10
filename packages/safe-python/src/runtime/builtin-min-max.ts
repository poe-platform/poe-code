import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { suggestName } from "./name-suggestion.js";
import type { IterationContext } from "./protocol-iterator.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface MinMaxContext {
  iteration?: IterationContext<RuntimeValue>;
  /** Execution-owned invocation, including callability checks and call limits. */
  call?(key: RuntimeValue, value: RuntimeValue): RuntimeValue;
  /** Rich comparison followed by truth conversion, including reflected slots. */
  compare?(operator: "<" | ">", candidate: RuntimeValue, best: RuntimeValue): boolean;
}

/** Streaming selection retains only the best member/key and current candidate.
 * Ties retain the first member. Key/default validation does not invoke a key on
 * empty input; failures never request closing the caller's iterator. */
export function createMinMaxBuiltin(name: "min" | "max", values: RuntimeValues, meter: ExecutionMeter, context: MinMaxContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const operator = name === "min" ? "<" : ">";
  return values.builtinFunction({ name, invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (positional.length === 0) throw new PythonRuntimeError("TypeError", `${name} expected at least 1 argument, got 0`);
    if (keywords.items.size > 2) throw new PythonRuntimeError("TypeError", `${name}() takes at most 2 keyword arguments (${keywords.items.size} given)`);
    let key: RuntimeValue | undefined, fallback: RuntimeValue | undefined;
    for (const [keyword, value] of keywords.items.snapshot()) {
      if (keyword.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
      let label = "";
      for (const point of keyword.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
      if (label === "key") key = value;
      else if (label === "default") fallback = value;
      else {
        const suggestion = suggestName(label, ["key", "default"], meter);
        const hint = suggestion === undefined ? "" : `. Did you mean '${suggestion}'?`;
        throw new PythonRuntimeError("TypeError", `${name}() got an unexpected keyword argument '${label}'${hint}`);
      }
    }
    if (positional.length > 1 && fallback !== undefined) throw new PythonRuntimeError("TypeError", `Cannot specify a default for ${name}() with multiple positional arguments`);
    const cursor = positional.length === 1 ? runtimeIterate(positional[0], values, meter, context.iteration ?? invocation?.iteration) : undefined;
    let best: RuntimeValue | undefined, bestKey: RuntimeValue | undefined, index = 0;
    for (;;) {
      meter.checkpoint();
      let candidate: RuntimeValue;
      if (cursor !== undefined) {
        const item = cursor.next(); meter.checkpoint();
        if (item.done) break;
        candidate = item.value;
      } else {
        if (index === positional.length) break;
        candidate = positional[index++];
      }
      let candidateKey = candidate;
      if (key !== undefined && key.kind !== "none") {
        if (context.call !== undefined) candidateKey = context.call(key, candidate);
        else if (invocation !== undefined) { meter.checkpoint(0, 8); candidateKey = invocation.call(key, [candidate]); }
        else throw new Error(`${name} requires an execution call capability`);
      }
      meter.checkpoint();
      if (best === undefined) { best = candidate; bestKey = candidateKey; continue; }
      const better = context.compare !== undefined ? context.compare(operator, candidateKey, bestKey!)
        : invocation?.compareTruth !== undefined ? invocation.compareTruth(operator, candidateKey, bestKey!)
        : runtimeComparison(operator, candidateKey, bestKey!, values, meter).value;
      meter.checkpoint();
      if (better) { best = candidate; bestKey = candidateKey; }
    }
    if (best !== undefined) return best;
    if (fallback !== undefined) return fallback;
    throw new PythonRuntimeError("ValueError", `${name}() iterable argument is empty`);
  } });
}

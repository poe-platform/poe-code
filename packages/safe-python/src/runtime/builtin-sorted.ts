import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { extendList, type ListExtensionContext } from "./list-extension.js";
import { ListStorage } from "./list-storage.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import { unexpectedBuiltinKeyword } from "./unexpected-builtin-keyword.js";
import { bindSortOptions } from "./sort-options.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface SortedContext {
  /** Complete execution-owned list materialization protocol, including native
   * inputs, guest iteration and length hints. Omission uses native inputs and
   * invocation-owned guest iteration and its optional length-hint policy. */
  extension?: ListExtensionContext<RuntimeValue>;
  callKey?(key: RuntimeValue, value: RuntimeValue): RuntimeValue;
  less?(left: RuntimeValue, right: RuntimeValue): boolean;
  truth?(value: RuntimeValue): boolean;
}

/** Materialize before keyword binding or reverse conversion, then use the same
 * stable-sort storage operation as list.sort. Exact comparison schedules and
 * advisory-hint preallocation retain the underlying kernels' documented gaps. */
export function createSortedBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: SortedContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "sorted", invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `sorted expected 1 argument, got ${positional.length}`);
    const source = positional[0], result = new ListStorage<RuntimeValue>([], meter);
    if (context.extension !== undefined) extendList(result, source, context.extension, meter);
    else if (source.kind === "list") result.extend(source.items);
    else result.extendIterator(runtimeIterate(source, values, meter, invocation?.iteration, undefined, true));
    meter.checkpoint();
    if (keywords.items.size > 2) throw new PythonRuntimeError("TypeError", `sort() takes at most 2 keyword arguments (${keywords.items.size} given)`);
    meter.checkpoint(0, 64 + keywords.items.size * 32);
    const options = new Map<string, RuntimeValue>();
    let unexpected = false;
    for (const [name, value] of keywords.items.snapshot()) {
      const payload = runtimeStringPayload(name);
      if (payload === undefined) throw new PythonRuntimeError("TypeError", "keywords must be strings");
      let label = "";
      for (const point of payload.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
      if (options.has(label)) unexpected = true;
      else options.set(label, value);
      if (label !== "key" && label !== "reverse") unexpected = true;
    }
    if (unexpected) unexpectedBuiltinKeyword("sort", keywords, ["key", "reverse"], values, meter, invocation);
    result.sort(bindSortOptions([], options, {
      isNone: value => value.kind === "none",
      truth: value => context.truth !== undefined ? context.truth(value)
        : invocation?.truth !== undefined ? invocation.truth(value) : runtimeTruth(value, meter),
      callKey(key, value) {
        if (context.callKey !== undefined) return context.callKey(key, value);
        if (invocation !== undefined) { meter.checkpoint(0, 8); return invocation.call(key, [value]); }
        throw new Error("sorted requires an execution call capability");
      },
      less: (a, b) => context.less !== undefined ? context.less(a, b)
        : invocation?.compareTruth !== undefined ? invocation.compareTruth("<", a, b)
        : runtimeComparison("<", a, b, values, meter).value
    }, meter));
    meter.checkpoint();
    return values.list(result);
  } });
}

import type { ExpressionCall } from "./call-arguments.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimeCallContext {
  readonly values: RuntimeValues;
  readonly keys: KeyOperations<RuntimeValue>;
  /** Error-only guest formatting, including the callable's trailing (). */
  name(callee: RuntimeValue): string;
  keywordName(key: RuntimeValue): string;
  /** Guest call-slot presence, queried only after all expansion succeeds. */
  callable(callee: RuntimeValue): boolean;
  /** Execute after callability and keyword validation. Keyword
   * keys retain Python code points, including surrogate sequences: converting
   * them to host Map<string, ...> can collapse distinct Python strings.
   */
  invoke(callee: RuntimeValue, positional: readonly RuntimeValue[], keywords: DictionaryValue): RuntimeValue;
}

/** Per-expression collector. No callability checks or formatting during setup.
 * Exact dict keyword merges reject duplicates with cached hashes; non-string
 * validation waits until invocation. Guest mapping/length-hint slots and full
 * temporary accounting remain wider object-runtime responsibilities.
 */
export function beginRuntimeCall(callee: RuntimeValue, context: RuntimeCallContext, meter: ExecutionMeter): ExpressionCall<RuntimeValue> {
  meter.checkpoint(1, 256);
  const positional: RuntimeValue[] = [];
  const keywords = context.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(context.keys, meter));
  const duplicate = (key: RuntimeValue): never => {
    const name = context.name(callee), keyword = context.keywordName(key);
    meter.checkpoint();
    throw new PythonRuntimeError("TypeError", `${name} got multiple values for keyword argument '${keyword}'`);
  };
  return {
    positional(value) { meter.checkpoint(1, 8); positional.push(value); },
    starred(value, loneStar = false) {
      let iterator: Iterator<RuntimeValue>;
      try { iterator = runtimeIterate(value, context.values, meter); }
      catch (error) {
        if (!(error instanceof PythonRuntimeError) || error.name !== "TypeError") throw error;
        const name = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
        const prefix = loneStar ? `${context.name(callee)} argument after` : "Value after";
        meter.checkpoint();
        throw new PythonRuntimeError("TypeError", `${prefix} * must be an iterable, not ${name}`);
      }
      while (true) {
        meter.checkpoint(); const item = iterator.next(); meter.checkpoint();
        if (item.done) return;
        meter.checkpoint(0, 8); positional.push(item.value);
      }
    },
    keywords(entries) {
      const group = new OrderedKeyMap<RuntimeValue, RuntimeValue>(context.keys, meter);
      for (const [name, value] of entries) { meter.checkpoint(); group.set(context.values.string(name), value); }
      keywords.items.update(group, duplicate);
    },
    mapping(value) {
      meter.checkpoint();
      if (value.kind !== "dict") {
        const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
        const name = context.name(callee); meter.checkpoint();
        throw new PythonRuntimeError("TypeError", `${name} argument after ** must be a mapping, not ${type}`);
      }
      keywords.items.update(value.items, duplicate);
    },
    invoke() {
      meter.checkpoint(1, 32);
      const callable = context.callable(callee); meter.checkpoint();
      if (!callable) {
        const name = callee.kind === "none" ? "NoneType" : callee.kind === "not-implemented" ? "NotImplementedType" : callee.kind;
        throw new PythonRuntimeError("TypeError", `'${name}' object is not callable`);
      }
      const iterator = keywords.items.iterate(key => key);
      for (let item = iterator.next(); !item.done; item = iterator.next()) {
        meter.checkpoint();
        if (item.value.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
      }
      const result = context.invoke(callee, Object.freeze(positional), keywords);
      meter.checkpoint(); return result;
    }
  };
}

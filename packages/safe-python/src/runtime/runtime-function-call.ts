import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { invokeFunction, type FunctionInvocationContext } from "./function-invocation.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import type { DictionaryValue, FunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimeFunctionContext extends Pick<FunctionInvocationContext<RuntimeValue, RuntimeValue>, "calls" | "body" | "suspended" | "classBody"> {
  readonly values: RuntimeValues;
  readonly keys: KeyOperations<RuntimeValue>;
}

/** Host diagnostic/source-name text only. Original keyword records remain in
 * storage; never use this UTF-16 spelling as a replacement dictionary key. */
function stringText(value: Extract<RuntimeValue, { kind: "str" }>, meter: ExecutionMeter): string {
  let result = "";
  for (const point of value.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); result += String.fromCodePoint(point); }
  return result;
}

/** Invoke a captured concrete function using collected arguments. Binding keeps
 * original keyword records, matches only exact source spellings, and builds fresh
 * tuple/dictionary variadics. Surrogates cannot occur in source identifiers and
 * must not accidentally match an astral identifier after UTF-16 conversion.
 * Namespace/closure storage remains live. Definition installation, suspension
 * backends, stack-independent call dispatch and guest tracebacks remain external.
 */
export function invokeRuntimeFunction(fn: FunctionValue, positional: readonly RuntimeValue[], keywords: DictionaryValue, context: RuntimeFunctionContext, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint(1, 256);
  const state = fn.value;
  if (state.qualifiedName.kind !== "str") throw new Error("function qualified name must be a string value");
  const keywordValues = new Map<RuntimeValue, RuntimeValue>();
  for (const [key, value] of keywords.items.snapshot()) {
    meter.checkpoint(1, 48);
    if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
    keywordValues.set(key, value);
  }
  const invocation: FunctionInvocationContext<RuntimeValue, RuntimeValue> = {
    globals: state.globals, builtins: state.builtins, closure: state.closure,
    none: context.values.none, calls: context.calls, body: context.body.bind(context),
    tuple: items => context.values.tuple(items),
    dictionary(items) {
      const storage = new OrderedKeyMap<RuntimeValue, RuntimeValue>(context.keys, meter, runtimeDictionaryStorage);
      for (const [key, value] of items) { meter.checkpoint(); storage.set(key, value); }
      return context.values.dictionary(storage);
    }
  };
  if (context.suspended) invocation.suspended = context.suspended.bind(context);
  if (context.classBody) invocation.classBody = context.classBody.bind(context);
  return invokeFunction(state.code, {
    name: stringText(state.qualifiedName, meter), positional, keywords: keywordValues, defaults: state.defaults,
    defaultOverrides: state.positionalDefaults === undefined && state.keywordDefaults === undefined ? undefined : {
      get positional() {
        const value = state.positionalDefaults;
        if (value === undefined) return undefined;
        if (value.kind === "none") return null;
        if (value.kind !== "tuple") throw Error("invalid positional default storage");
        return value.items;
      },
      keyword: state.keywordDefaults === undefined ? undefined : name => {
        const value = state.keywordDefaults;
        if (value === undefined || value.kind === "none") return undefined;
        if (value.kind !== "dict") throw Error("invalid keyword default storage");
        return value.items.lookup(context.values.string(name));
      }
    },
    keywordNames: {
      parameter(key) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        for (const point of key.value) { meter.checkpoint(); if (point >= 0xd800 && point <= 0xdfff) return undefined; }
        return stringText(key, meter);
      },
      display(key) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        return stringText(key, meter);
      }
    }
  }, invocation, meter);
}

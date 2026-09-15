import { manglePrivateName } from "../private-names.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import type { DictionaryValue, FunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Reflect captured defaults once, preserving value identity and mangled names.
 * Later calls consult these guest containers, including direct dictionary edits. */
export function runtimeFunctionDefaults(fn: FunctionValue, name: "__defaults__" | "__kwdefaults__", values: RuntimeValues, meter: ExecutionMeter, keys?: KeyOperations<RuntimeValue>): RuntimeValue {
  meter.checkpoint();
  const field = name === "__defaults__" ? "positionalDefaults" : "keywordDefaults", state = fn.value;
  if (state[field] !== undefined) return state[field];
  const source = new Map<string, RuntimeValue>();
  for (const [key, value] of state.defaults) { meter.checkpoint(1, 48); source.set(manglePrivateName(key, state.code.scope.scope.privateName), value); }
  const node = state.code.scope.scope.node, positional: RuntimeValue[] = [];
  let dictionary: DictionaryValue | undefined;
  if (node.kind === "function" || node.kind === "lambda") for (const parameter of node.parameters) {
    meter.checkpoint();
    if (parameter.kind === "var-positional" || parameter.kind === "var-keyword" || (parameter.kind === "keyword-only") !== (name === "__kwdefaults__")) continue;
    const key = manglePrivateName(parameter.name, state.code.scope.scope.privateName), value = source.get(key);
    if (value === undefined) continue;
    if (name === "__defaults__") { meter.checkpoint(0, 8); positional.push(value); }
    else {
      if (keys === undefined) throw Error("keyword default dictionaries require a key policy");
      dictionary ??= values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage));
      dictionary.items.set(values.string(key), value);
    }
  }
  const result = name === "__defaults__" ? positional.length === 0 ? values.none : values.tuple(positional) : dictionary ?? values.none;
  meter.checkpoint(); state[field] = result; return result;
}

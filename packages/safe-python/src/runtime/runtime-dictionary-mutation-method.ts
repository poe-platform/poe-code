import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonKeyError, runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { updateRuntimeDictionary } from "./runtime-dictionary-update.js";
import type { BuiltinFunctionValue, DictionaryValue, RuntimeValues } from "./runtime-values.js";

/** Explicit exact-dict mutation binding; never install these on mapping proxies.
 * The dispatcher owns descriptor discovery and native method introspection.
 * Updates retain partial progress, including positional writes before invalid
 * keyword-name rejection under their native keyword-dictionary calling convention.
 */
export function createRuntimeDictionaryMutationMethod(receiver: DictionaryValue, name: "clear" | "pop" | "popitem" | "setdefault" | "update", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    ...(name === "update" ? { keywordValidation: "callee" as const } : {}),
    invoke(positional, keywords, meter, context) {
      meter.checkpoint();
      if (name === "update") {
        if (positional.length > 1) throw new PythonRuntimeError("TypeError", `update expected at most 1 argument, got ${positional.length}`);
        if (positional.length === 1) updateRuntimeDictionary(receiver, positional[0], values, meter, context);
        const keys = keywords.items.iterate(key => key);
        for (let item = keys.next(); !item.done; item = keys.next()) {
          meter.checkpoint();
          if (item.value.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        }
        receiver.items.update(keywords.items);
        meter.checkpoint();
        return values.none;
      }
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `dict.${name}() takes no keyword arguments`);
      if (name === "pop" || name === "setdefault") {
        if (positional.length < 1) throw new PythonRuntimeError("TypeError", `${name} expected at least 1 argument, got 0`);
        if (positional.length > 2) throw new PythonRuntimeError("TypeError", `${name} expected at most 2 arguments, got ${positional.length}`);
        const key = positional[0];
        if (name === "setdefault") return runtimeDictionaryAccess(receiver, key, { kind: "setdefault", value: positional[1] ?? values.none }, meter);
        const found = runtimeDictionaryAccess(receiver, key, "pop", meter);
        if (found !== undefined) return found.value;
        if (positional.length === 2) return positional[1];
        throw new PythonKeyError(key, meter);
      }
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `dict.${name}() takes no arguments (${positional.length} given)`);
      if (name === "clear") { receiver.items.clear(); return values.none; }
      meter.checkpoint(1, 32);
      const result = receiver.items.popitem((key, value) => values.tuple([key, value]));
      if (result === undefined) throw new PythonKeyError(values.string("popitem(): dictionary is empty"), meter);
      return result;
    }
  });
}

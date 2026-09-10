import type { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeIndex } from "./runtime-index.js";
import { translateString, type CharacterTranslation } from "./string-translation.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RuntimeStringTranslationContext {
  lookup?(mapping: RuntimeValue, key: RuntimeValue): RuntimeValue;
  /** Recognize guest LookupError subclasses, never fatal execution limits. */
  isLookupError?(error: unknown): boolean;
  /** Pure subclass payload inspection; no integer/string coercion hooks. */
  integer?(value: RuntimeValue): bigint | undefined;
  string?(value: RuntimeValue): CodePointString | undefined;
}

/** Mapping lookups follow the kernel's observable cache/retry schedule.
 * Only LookupError means identity; None deletes, and str results may expand. */
export function createRuntimeStringTranslateMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, values: RuntimeValues, meter: ExecutionMeter, context: RuntimeStringTranslationContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "translate",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "str.translate() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `str.translate() takes exactly one argument (${positional.length} given)`);
      if (receiver.value.length === 0) return receiver;
      meter.checkpoint(0, 64);
      const mapping = (point: number): CharacterTranslation => {
        const key = values.integer(point); let result: RuntimeValue;
        try { result = context.lookup === undefined ? runtimeIndex(positional[0], key, values, meter) : context.lookup(positional[0], key); }
        catch (error) {
          meter.checkpoint();
          const missing = error instanceof PythonRuntimeError && (error.name === "KeyError" || error.name === "IndexError" || error.name === "LookupError") || context.isLookupError?.(error) === true;
          meter.checkpoint();
          if (missing) return undefined;
          throw error;
        }
        meter.checkpoint();
        if (result.kind === "none") return null;
        const integer = result.kind === "int" ? result.value : result.kind === "bool" ? (result.value ? 1n : 0n) : context.integer?.(result);
        meter.checkpoint();
        if (integer !== undefined) {
          if (integer < 0n || integer > 0x10ffffn) throw new PythonRuntimeError("ValueError", "character mapping must be in range(0x110000)");
          return Number(integer);
        }
        const string = result.kind === "str" ? result.value : context.string?.(result);
        meter.checkpoint();
        if (string !== undefined) return string;
        throw new PythonRuntimeError("TypeError", "character mapping must return integer, None or str");
      };
      return values.stringPoints(translateString(receiver.value, mapping, meter));
    }
  });
}

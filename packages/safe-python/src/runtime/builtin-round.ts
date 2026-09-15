import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerIndex, type IntegerIndexContext } from "./index-protocol.js";
import { unexpectedBuiltinKeyword } from "./unexpected-builtin-keyword.js";
import { floatRound } from "./rounding.js";
import { roundRuntimeInteger } from "./runtime-integer-round.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface RoundContext {
  /** Type-level __round__ lookup/binding. Disabled slots must fail on invocation.
   * Undefined digits means invoke with no argument, not with guest None. */
  lookupRound?(value: RuntimeValue): ((digits?: RuntimeValue) => RuntimeValue) | undefined;
  typeName?(value: RuntimeValue): string;
  readonly index?: IntegerIndexContext<RuntimeValue>;
}

/** Native number rounding plus explicit guest special-method capabilities.
 * Native ndigits uses __index__; guest __round__ receives it unchanged. */
export function createRoundBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: RoundContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "round", invoke(positional, keywords, meter, invocation) {
    meter.checkpoint();
    const count = positional.length + keywords.items.size;
    if (count > 2) throw new PythonRuntimeError("TypeError", `round() takes at most 2 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
    let number: RuntimeValue | undefined = positional[0], digits: RuntimeValue | undefined = positional[1], unexpected: string | undefined;
    for (const [key, value] of keywords.items.snapshot()) {
      const payload = runtimeStringPayload(key);
      if (payload === undefined) throw new PythonRuntimeError("TypeError", "keywords must be strings");
      let label = "";
      for (const point of payload.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
      if (label !== "number" && label !== "ndigits") { unexpected ??= label; continue; }
      const position = label === "number" ? 1 : 2;
      if (positional.length >= position) throw new PythonRuntimeError("TypeError", `argument for round() given by name ('${label}') and position (${position})`);
      if (label === "number" && number === undefined) number = value;
      else if (label === "ndigits" && digits === undefined) digits = value;
      else unexpected ??= label;
    }
    if (number === undefined) throw new PythonRuntimeError("TypeError", "round() missing required argument 'number' (pos 1)");
    if (unexpected !== undefined) unexpectedBuiltinKeyword("round", keywords, ["number", "ndigits"], values, meter, invocation);
    if (digits?.kind === "none") digits = undefined;
    if (number.kind !== "int" && number.kind !== "bool" && number.kind !== "float") {
      const slot = context.lookupRound?.(number);
      meter.checkpoint();
      if (slot !== undefined) {
        const result = digits === undefined ? slot() : slot(digits);
        meter.checkpoint();
        return result;
      }
      if (context.lookupRound === undefined) {
        const method = invocation?.lookupSpecial?.(number, "__round__"); meter.checkpoint();
        if (method !== undefined) {
          meter.checkpoint(0, 8);
          const result = invocation!.call(method, digits === undefined ? [] : [digits]); meter.checkpoint(); return result;
        }
      }
      const name = context.typeName?.(number) ?? invocation?.typeName?.(number) ?? (number.kind === "none" ? "NoneType" : number.kind === "not-implemented" ? "NotImplementedType" : number.kind);
      throw new PythonRuntimeError("TypeError", `type ${diagnosticTypeName(name, meter, 100)} doesn't define __round__ method`);
    }
    const index = context.index ?? invocation?.integerIndex;
    const places = digits === undefined ? undefined : index === undefined ? runtimeIntegerIndex(digits, meter) : integerIndex(digits, index, meter);
    meter.checkpoint();
    if (number.kind === "float") {
      // Binary64 ratios and decimal factors here have a fixed bounded size.
      meter.checkpoint(128, 8192);
      return places === undefined ? values.integer(floatRound(number.value)) : values.float(floatRound(number.value, places));
    }
    return roundRuntimeInteger(number, places, values, meter);
  } });
}

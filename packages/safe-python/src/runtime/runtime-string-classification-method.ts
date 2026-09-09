import { isIdentifierContinue, isIdentifierStart } from "../identifiers.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { isUnicodeWhitespace } from "./unicode-whitespace.js";
import { isUnicodeCharacter, type UnicodeClassification } from "./unicode-character-classification.js";

/** Exact string predicates reuse the parser's Unicode identifier tables and
 * runtime whitespace definition. Identifier syntax includes reserved keywords;
 * this does not perform name binding, normalization or keyword rejection. */
export function createRuntimeStringClassificationMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, name: "isascii" | "isspace" | "isidentifier" | "isalnum" | UnicodeClassification, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no arguments (${positional.length} given)`);
      if (receiver.value.length === 0) return values.boolean(name === "isascii" || name === "isprintable");
      let first = true;
      for (const point of receiver.value) {
        meter.checkpoint();
        const valid = name === "isascii" ? point < 128 : name === "isspace" ? isUnicodeWhitespace(point)
          : name === "isidentifier" ? (first ? isIdentifierStart(point) : isIdentifierContinue(point))
          : name === "isalnum" ? isUnicodeCharacter(point, "isalpha", meter) || isUnicodeCharacter(point, "isnumeric", meter)
          : isUnicodeCharacter(point, name, meter);
        if (!valid) return values.false;
        first = false;
      }
      return values.true;
    }
  });
}

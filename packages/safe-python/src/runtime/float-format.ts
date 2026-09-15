import { CodePointString } from "./code-point-string.js";
import { unknownFormatCode } from "./unknown-format-code.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { UnsupportedExpressionError } from "./expression-evaluation.js";
import { parseFormatSpec } from "./format-spec.js";
import { resolveNumericLocale, type NumericLocaleSource } from "./numeric-locale.js";

/** Native float payload formatting; locale-aware n remains a separate policy. */
export function floatFormat(value: number, spec: CodePointString, typeName: string, meter: ExecutionMeter, locale?: NumericLocaleSource): CodePointString {
  const field = parseFormatSpec(spec, 0, ">", typeName, meter);
  switch (field.type) {
    case 0: case 101: case 69: case 102: case 70: case 103: case 71: case 37:
      return CodePointString.fromFloatFormat(value, field, meter);
    case 110:
      if (locale === undefined) throw new UnsupportedExpressionError("call");
      return CodePointString.fromFloatFormat(value, field, meter, resolveNumericLocale(locale, meter));
    default: return unknownFormatCode(field.type, typeName, meter);
  }
}

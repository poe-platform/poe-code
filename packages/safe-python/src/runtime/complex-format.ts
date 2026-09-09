import { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { UnsupportedExpressionError } from "./expression-evaluation.js";
import { parseFormatSpec } from "./format-spec.js";
import { unknownFormatCode } from "./unknown-format-code.js";
import type { NumericLocale } from "./numeric-locale.js";

/** Native complex payload dispatch. Locale-aware n remains a separate policy. */
export function complexFormat(real: number, imaginary: number, spec: CodePointString, typeName: string, meter: ExecutionMeter, locale?: NumericLocale): CodePointString {
  const field = parseFormatSpec(spec, 0, ">", typeName, meter);
  switch (field.type) {
    case 0: case 101: case 69: case 102: case 70: case 103: case 71:
      return CodePointString.fromComplexFormat(real, imaginary, field, meter);
    case 110:
      if (locale === undefined) throw new UnsupportedExpressionError("call");
      return CodePointString.fromComplexFormat(real, imaginary, field, meter, locale);
    default: return unknownFormatCode(field.type, typeName, meter);
  }
}

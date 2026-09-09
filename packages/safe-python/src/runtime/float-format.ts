import { CodePointString } from "./code-point-string.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { UnsupportedExpressionError } from "./expression-evaluation.js";
import { parseFormatSpec } from "./format-spec.js";

/** Native float payload formatting; locale-aware n remains a separate policy. */
export function floatFormat(value: number, spec: CodePointString, typeName: string, meter: ExecutionMeter): CodePointString {
  const field = parseFormatSpec(spec, 0, ">", typeName, meter);
  switch (field.type) {
    case 0: case 101: case 69: case 102: case 70: case 103: case 71: case 37:
      return CodePointString.fromFloatFormat(value, field, meter);
    case 110: throw new UnsupportedExpressionError("call");
    default: {
      const code = field.type > 32 && field.type < 128 ? String.fromCharCode(field.type) : `\\x${field.type.toString(16)}`;
      throw new PythonRuntimeError("ValueError", `Unknown format code '${code}' for object of type '${diagnosticTypeName(typeName, meter)}'`);
    }
  }
}

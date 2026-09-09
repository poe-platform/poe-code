import { CodePointString } from "./code-point-string.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { UnsupportedExpressionError } from "./expression-evaluation.js";
import { parseFormatSpec } from "./format-spec.js";
import { integerToFloat } from "./numeric-conversion.js";

/** Integer payload formatting; callers retain bool's empty-spec str behavior.
 * Float presentations share the binary64 renderer after checked conversion;
 * locale-aware presentation remains a separate policy. */
export function integerFormat(value: bigint, spec: CodePointString, typeName: string, meter: ExecutionMeter, maxDecimalDigits?: number): CodePointString {
  const field = parseFormatSpec(spec, 100, ">", typeName, meter);
  switch (field.type) {
    case 98: case 111: case 100: case 120: case 88:
      return CodePointString.fromIntegerRadixFormat(value, field, meter, maxDecimalDigits);
    case 99: {
      if (field.precision !== null) throw new PythonRuntimeError("ValueError", "Precision not allowed in integer format specifier");
      if (field.noNegativeZero) throw new PythonRuntimeError("ValueError", "Negative zero coercion (z) not allowed in integer format specifier");
      if (field.sign !== null) throw new PythonRuntimeError("ValueError", "Sign not allowed with integer format specifier 'c'");
      if (field.alternate) throw new PythonRuntimeError("ValueError", "Alternate form (#) not allowed with integer format specifier 'c'");
      if (value < -9223372036854775808n || value > 9223372036854775807n) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C long");
      if (value < 0n || value > 0x10ffffn) throw new PythonRuntimeError("OverflowError", "%c arg not in range(0x110000)");
      meter.checkpoint(0, Uint32Array.BYTES_PER_ELEMENT);
      const source = new CodePointString(Uint32Array.of(Number(value)), meter);
      return source.formatField(field.width ?? 0n, null, field.align === "<" ? "left" : field.align === "^" ? "center" : "right", field.fill, meter);
    }
    case 101: case 69: case 102: case 70: case 103: case 71: case 37: {
      meter.checkpoint();
      const converted = integerToFloat(value); meter.checkpoint();
      return CodePointString.fromFloatFormat(converted, field, meter);
    }
    case 110: throw new UnsupportedExpressionError("call");
    default: {
      const code = field.type > 32 && field.type < 128 ? String.fromCharCode(field.type) : `\\x${field.type.toString(16)}`;
      throw new PythonRuntimeError("ValueError", `Unknown format code '${code}' for object of type '${diagnosticTypeName(typeName, meter)}'`);
    }
  }
}

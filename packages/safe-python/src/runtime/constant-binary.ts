import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { realBinary } from "./real-binary.js";
import { complexBinary } from "./complex-binary.js";
import { integerBitwise } from "./integer-bitwise.js";
import { integerShift } from "./integer-shift.js";
import { integerPower } from "./integer-power.js";
import { floatPower } from "./float-power.js";
import { complexPower } from "./complex-power.js";
import { constantConcat } from "./constant-concat.js";
import { constantRepeat } from "./constant-repeat.js";

/** Compose exact immutable builtin arithmetic for expression/runtime adapters.
 * Each kernel declines unsupported operand kinds before conversion, while
 * matched-operation errors propagate. This is not guest reflected dispatch:
 * subclasses/mutable types and string formatting still
 * require their runtime handlers. Unknown operators are host implementation
 * errors; recognized but unavailable operations return NotImplemented.
 */
export function constantBinary(operator: string, left: ConstantValue, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  switch (operator) {
    case "&": case "|": case "^": return integerBitwise(operator, left, right, values, meter);
    case "<<": case ">>": return integerShift(operator, left, right, values, meter);
    case "**":
      if (left.kind === "complex" || right.kind === "complex") return complexPower(left, right, values, meter);
      return left.kind === "float" || right.kind === "float" ? floatPower(left, right, values, meter) : integerPower(left, right, values, meter);
    case "//": case "%": return realBinary(operator, left, right, values, meter);
    case "@": return values.notImplemented;
    case "+": case "-": case "*": case "/": {
      const real = realBinary(operator, left, right, values, meter);
      if (real !== values.notImplemented) return real;
      const complex = complexBinary(operator, left, right, values, meter);
      if (complex !== values.notImplemented) return complex;
      if (operator === "+") return constantConcat(left, right, values, meter);
      if (operator === "*") return constantRepeat(left, right, values, meter);
      return values.notImplemented;
    }
    default: throw new Error(`unsupported binary operator: ${operator}`);
  }
}

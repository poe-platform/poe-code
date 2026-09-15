import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerDivmod, integerTrueDivide } from "./integer-arithmetic.js";
import { floatDivmod, floatTrueDivide } from "./float-arithmetic.js";
import { integerToFloat } from "./numeric-conversion.js";

/** Combined exact builtin real-pair arithmetic, not an exposed individual type
 * slot. Nonreal pairs decline before conversion so complex/sequence/reflected
 * dispatch can proceed. Powers, bitwise operations and matrix multiplication
 * belong to other kernels. Tagged results and operation entry are metered, but
 * bigint payload allocation and size-dependent host arithmetic remain unfinished.
 */
export function realBinary(operator: string, left: ConstantValue, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (operator !== "+" && operator !== "-" && operator !== "*" && operator !== "/" && operator !== "//" && operator !== "%") throw new Error(`unsupported real binary operator: ${operator}`);
  if (left.kind !== "bool" && left.kind !== "int" && left.kind !== "float") return values.notImplemented;
  if (right.kind !== "bool" && right.kind !== "int" && right.kind !== "float") return values.notImplemented;
  const a = left.kind === "bool" ? (left.value ? 1n : 0n) : left.value;
  const b = right.kind === "bool" ? (right.value ? 1n : 0n) : right.value;
  if (typeof a === "bigint" && typeof b === "bigint") {
    switch (operator) {
      case "+": return values.integer(a + b);
      case "-": return values.integer(a - b);
      case "*": return values.integer(a * b);
      case "/": return values.float(integerTrueDivide(a, b));
      case "//": return values.integer(integerDivmod(a, b).quotient);
      case "%": return values.integer(integerDivmod(a, b).remainder);
    }
  }
  // Conversion precedes zero-divisor validation; oversized mixed integer
  // operands raise OverflowError even when the floating divisor is zero.
  const x = typeof a === "bigint" ? integerToFloat(a) : a;
  const y = typeof b === "bigint" ? integerToFloat(b) : b;
  switch (operator) {
    case "+": return values.float(x + y);
    case "-": return values.float(x - y);
    case "*": return values.float(x * y);
    case "/": return values.float(floatTrueDivide(x, y));
    case "//": return values.float(floatDivmod(x, y).quotient);
    case "%": return values.float(floatDivmod(x, y).remainder);
  }
}

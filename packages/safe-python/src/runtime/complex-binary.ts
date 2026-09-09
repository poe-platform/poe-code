import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerToFloat } from "./numeric-conversion.js";
import { PythonRuntimeError } from "./error.js";
import { floatFma } from "./float-fma.js";

function copySign(magnitude: number, sign: number, meter: ExecutionMeter): number {
  if (Number.isNaN(sign)) {
    meter.checkpoint(1, 8);
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, sign);
    return bits.getUint8(0) & 128 ? -magnitude : magnitude;
  }
  return sign < 0 || Object.is(sign, -0) ? -magnitude : magnitude;
}

function product(a: number, b: number, c: number, d: number, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  const ac = a * c, bd = b * d, ad = a * d, bc = b * c;
  let real = ac - bd, imaginary = ad + bc;
  if (Number.isNaN(real) && Number.isNaN(imaginary)) {
    let recover = false;
    if (Math.abs(a) === Infinity || Math.abs(b) === Infinity) {
      a = copySign(Math.abs(a) === Infinity ? 1 : 0, a, meter);
      b = copySign(Math.abs(b) === Infinity ? 1 : 0, b, meter);
      if (Number.isNaN(c)) c = copySign(0, c, meter);
      if (Number.isNaN(d)) d = copySign(0, d, meter);
      recover = true;
    }
    if (Math.abs(c) === Infinity || Math.abs(d) === Infinity) {
      c = copySign(Math.abs(c) === Infinity ? 1 : 0, c, meter);
      d = copySign(Math.abs(d) === Infinity ? 1 : 0, d, meter);
      if (Number.isNaN(a)) a = copySign(0, a, meter);
      if (Number.isNaN(b)) b = copySign(0, b, meter);
      recover = true;
    }
    if (!recover && (Math.abs(ac) === Infinity || Math.abs(bd) === Infinity || Math.abs(ad) === Infinity || Math.abs(bc) === Infinity)) {
      if (Number.isNaN(a)) a = copySign(0, a, meter);
      if (Number.isNaN(b)) b = copySign(0, b, meter);
      if (Number.isNaN(c)) c = copySign(0, c, meter);
      if (Number.isNaN(d)) d = copySign(0, d, meter);
      recover = true;
    }
    if (recover) { real = Infinity * (a * c - b * d); imaginary = Infinity * (a * d + b * c); }
  }
  return values.complex(real, imaginary);
}

function quotient(a: number, b: number, c: number, d: number, realNumerator: boolean, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  // Explicit fusion preserves the rounding of the reference CPython build,
  // independently of whether the host JavaScript engine exposes hardware FMA.
  const cAbs = Math.abs(c), dAbs = Math.abs(d);
  let real: number, imaginary: number;
  if (cAbs >= dAbs) {
    if (cAbs === 0) throw new PythonRuntimeError("ZeroDivisionError", "division by zero");
    const ratio = d / c, denominator = floatFma(d, ratio, c, meter);
    real = (realNumerator ? a : floatFma(b, ratio, a, meter)) / denominator;
    imaginary = (realNumerator ? -a * ratio : floatFma(-a, ratio, b, meter)) / denominator;
  } else if (dAbs >= cAbs) {
    const ratio = c / d, denominator = floatFma(c, ratio, d, meter);
    real = (realNumerator ? a * ratio : floatFma(a, ratio, b, meter)) / denominator;
    imaginary = (realNumerator ? -a : floatFma(b, ratio, -a, meter)) / denominator;
  } else { real = NaN; imaginary = NaN; }
  if (Number.isNaN(real) && Number.isNaN(imaginary)) {
    if (!realNumerator && (Math.abs(a) === Infinity || Math.abs(b) === Infinity) && Number.isFinite(c) && Number.isFinite(d)) {
      const x = copySign(Math.abs(a) === Infinity ? 1 : 0, a, meter), y = copySign(Math.abs(b) === Infinity ? 1 : 0, b, meter);
      real = Infinity * (x * c + y * d); imaginary = Infinity * (y * c - x * d);
    } else if ((cAbs === Infinity || dAbs === Infinity) && Number.isFinite(a) && (realNumerator || Number.isFinite(b))) {
      const x = copySign(cAbs === Infinity ? 1 : 0, c, meter), y = copySign(dAbs === Infinity ? 1 : 0, d, meter);
      real = 0 * (realNumerator ? a * x : a * x + b * y);
      imaginary = 0 * (realNumerator ? -a * y : b * x - a * y);
    }
  }
  return values.complex(real, imaginary);
}

/** Exact builtin complex +, -, *, / with Python 3.14 mixed-real paths, scaled
 * division and C Annex G nonfinite recovery. At least one operand must be complex;
 * other numeric pairs decline. Powers and user-defined slot dispatch are separate.
 * Tagged results/NaN-sign buffers are charged; full host heap accounting is pending.
 */
export function complexBinary(operator: string, left: ConstantValue, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (operator !== "+" && operator !== "-" && operator !== "*" && operator !== "/") throw new Error(`unsupported complex binary operator: ${operator}`);
  if (left.kind !== "complex" && right.kind !== "complex") return values.notImplemented;
  if (left.kind !== "complex" && left.kind !== "float" && left.kind !== "int" && left.kind !== "bool") return values.notImplemented;
  if (right.kind !== "complex" && right.kind !== "float" && right.kind !== "int" && right.kind !== "bool") return values.notImplemented;
  const a = left.kind === "complex" ? left.real : left.kind === "int" ? integerToFloat(left.value) : left.kind === "bool" ? Number(left.value) : left.value;
  const b = left.kind === "complex" ? left.imaginary : 0;
  const c = right.kind === "complex" ? right.real : right.kind === "int" ? integerToFloat(right.value) : right.kind === "bool" ? Number(right.value) : right.value;
  const d = right.kind === "complex" ? right.imaginary : 0;
  switch (operator) {
    case "+": return values.complex(a + c, left.kind !== "complex" ? d : right.kind !== "complex" ? b : b + d);
    case "-": return values.complex(a - c, left.kind !== "complex" ? -d : right.kind !== "complex" ? b : b - d);
    case "*":
      if (left.kind !== "complex") return values.complex(c * a, d * a);
      if (right.kind !== "complex") return values.complex(a * c, b * c);
      return product(a, b, c, d, values, meter);
    case "/":
      if (right.kind !== "complex") {
        if (c === 0) throw new PythonRuntimeError("ZeroDivisionError", "division by zero");
        return values.complex(a / c, b / c);
      }
      return quotient(a, b, c, d, left.kind !== "complex", values, meter);
  }
}

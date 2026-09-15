import { CompensatedSum } from "./compensated-sum.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { CompletionIterator } from "./iterator-completion.js";
import { integerToFloat } from "./numeric-conversion.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { runtimeFloatPayload } from "./runtime-float-payload.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

const MIN_FAST_INTEGER = -(1n << 63n);
const MAX_FAST_INTEGER = (1n << 63n) - 1n;

/** Python 3.14's staged sum: bounded integer, compensated float, compensated
 * complex, then ordinary addition. Phases are visited at most once, not selected
 * again after each add: Boolean/large-int starts go directly to generic addition.
 * The call capability owns reflected slots and ordinary (never in-place) add.
 * The 64-bit fast interval matches the runtime's signed-size target. */
export function sumIterator(cursor: CompletionIterator<RuntimeValue>, start: RuntimeValue, values: RuntimeValues, add: (left: RuntimeValue, right: RuntimeValue) => RuntimeValue, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  let result = start;
  if (result.kind === "int" && result.value >= MIN_FAST_INTEGER && result.value <= MAX_FAST_INTEGER) {
    let integer = result.value;
    for (;;) {
      meter.checkpoint(); const item = cursor.next(); meter.checkpoint();
      if (item.done) return values.integer(integer);
      const value = item.value;
      if (value.kind === "int" || value.kind === "bool") {
        const operand = value.kind === "int" ? value.value : value.value ? 1n : 0n;
        if (operand >= MIN_FAST_INTEGER && operand <= MAX_FAST_INTEGER) {
          meter.checkpoint(1, 16);
          const total = integer + operand;
          if (total >= MIN_FAST_INTEGER && total <= MAX_FAST_INTEGER) { integer = total; continue; }
        }
      }
      result = add(values.integer(integer), value); meter.checkpoint();
      break;
    }
  }
  if (result.kind === "float") {
    const real = new CompensatedSum(result.value, meter);
    for (;;) {
      meter.checkpoint(); const item = cursor.next(); meter.checkpoint();
      if (item.done) return values.float(real.toNumber());
      const value = item.value;
      if (value.kind === "float") { real.add(value.value); continue; }
      const integer = runtimeIntegerPayload(value);
      if (integer !== undefined) {
        real.add(integer.kind === "int" ? integerToFloat(integer.value) : integer.value ? 1 : 0); continue;
      }
      result = add(values.float(real.toNumber()), value); meter.checkpoint();
      break;
    }
  }
  if (result.kind === "complex") {
    const real = new CompensatedSum(result.real, meter), imaginary = new CompensatedSum(result.imaginary, meter);
    for (;;) {
      meter.checkpoint(); const item = cursor.next(); meter.checkpoint();
      if (item.done) return values.complex(real.toNumber(), imaginary.toNumber());
      const value = item.value;
      if (value.kind === "complex") { real.add(value.real); imaginary.add(value.imaginary); continue; }
      // CPython accepts numeric subtype storage in these phases without
      // invoking conversion or arithmetic overrides. Float accumulation still
      // requires exact floats, and complex accumulation exact complex values.
      const integer = runtimeIntegerPayload(value);
      if (integer !== undefined) {
        real.add(integer.kind === "int" ? integerToFloat(integer.value) : integer.value ? 1 : 0); continue;
      }
      const floating = runtimeFloatPayload(value);
      if (floating !== undefined) { real.add(floating.value); continue; }
      result = add(values.complex(real.toNumber(), imaginary.toNumber()), value); meter.checkpoint();
      break;
    }
  }
  for (;;) {
    meter.checkpoint(); const item = cursor.next(); meter.checkpoint();
    if (item.done) return result;
    result = add(result, item.value); meter.checkpoint();
  }
}

import { complexMagnitude } from "./complex-magnitude.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface AbsHooks {
  /** Type-level special lookup, not instance attribute lookup or coercion.
   * Return a bound slot; disabled/noncallable slots must fail when invoked. */
  lookupAbs?(value: RuntimeValue): (() => RuntimeValue) | undefined;
  typeName?(value: RuntimeValue): string;
}

/** Explicit registration of positional-only abs. Exact native numeric values
 * use their slots; guest slots may return any value, including NotImplemented.
 * Integer size inspection inherits integerBitMetric's host-conversion limits. */
export function createAbsBuiltin(values: RuntimeValues, meter: ExecutionMeter, hooks: AbsHooks = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "abs", invoke(positional, keywords, meter) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "abs() takes no keyword arguments");
    if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `abs() takes exactly one argument (${positional.length} given)`);
    const value = positional[0];
    switch (value.kind) {
      case "bool": return values.integer(value.value ? 1n : 0n);
      case "int": {
        if (value.value >= 0n) return value;
        const bits = integerBitMetric(value.value, "bit_length", meter);
        meter.checkpoint(Math.ceil(bits / 64), 32 + Math.ceil(bits / 8));
        return values.integer(-value.value);
      }
      case "float": return values.float(Math.abs(value.value));
      case "complex": return values.float(complexMagnitude(value.real, value.imaginary, meter));
    }
    const slot = hooks.lookupAbs?.(value);
    meter.checkpoint();
    if (slot !== undefined) {
      const result = slot();
      meter.checkpoint();
      return result;
    }
    const name = hooks.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
    throw new PythonRuntimeError("TypeError", `bad operand type for abs(): '${diagnosticTypeName(name, meter)}'`);
  } });
}

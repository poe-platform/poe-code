import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact numeric data members. Unsupported names return to ordinary lookup. */
export function runtimeNumericAttribute(receiver: Extract<RuntimeValue, { kind: "int" | "bool" | "float" | "complex" }>, name: string, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue | undefined {
  meter.checkpoint();
  if (receiver.kind === "int" || receiver.kind === "bool") {
    if (name === "real" || name === "numerator") return receiver.kind === "int" ? receiver : values.integer(receiver.value ? 1n : 0n);
    if (name === "imag") return values.integer(0n);
    if (name === "denominator") return values.integer(1n);
  } else if (receiver.kind === "float") {
    if (name === "real") return receiver;
    if (name === "imag") return values.float(0);
  } else {
    if (name === "real") return values.float(receiver.real);
    if (name === "imag") return values.float(receiver.imaginary);
  }
  return undefined;
}

import { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";
import { integerDigits } from "./integer-digits.js";
import { floatRepresentation } from "./float-representation.js";
import { complexRepresentation } from "./complex-representation.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

type RepresentationScalar = Extract<RuntimeValue, { kind: "str" | "bytes" | "int" | "bool" | "float" | "complex" | "none" | "ellipsis" | "not-implemented" }>;

/** One capability guard shared by attribute and implicit representation lookup. */
export function isRuntimeRepresentationScalar(value: RuntimeValue): value is RepresentationScalar {
  return value.kind === "str" || value.kind === "bytes" || value.kind === "int" || value.kind === "bool"
    || value.kind === "float" || value.kind === "complex" || value.kind === "none" || value.kind === "ellipsis" || value.kind === "not-implemented";
}

/** Implemented exact scalar slots; guest subclass dispatch and method-wrapper
 * introspection are separate from these explicitly bound native capabilities. */
export function createRuntimeScalarRepresentationMethod(receiver: RepresentationScalar, name: "__str__" | "__repr__", values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      return runtimeScalarRepresentation(receiver, name, values, meter);
    }
  });
}

/** Shared native slot operation, separate from explicit method argument checks. */
export function runtimeScalarRepresentation(receiver: RepresentationScalar, name: "__str__" | "__repr__", values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  if (receiver.kind === "none") return values.string("None");
  if (receiver.kind === "ellipsis") return values.string("Ellipsis");
  if (receiver.kind === "not-implemented") return values.string("NotImplemented");
  if (receiver.kind === "float") return values.string(floatRepresentation(receiver.value, meter));
  if (receiver.kind === "complex") return values.string(complexRepresentation(receiver.real, receiver.imaginary, meter));
  if (receiver.kind === "int") return values.string(integerDigits(receiver.value, 10, meter));
  if (receiver.kind === "bool") return values.string(receiver.value ? "True" : "False");
  if (receiver.kind === "str" && name === "__str__") return receiver;
  const text = receiver.kind === "str" ? receiver.value.repr(false, meter) : CodePointString.fromBytesRepr(receiver.value, meter);
  return values.stringPoints(text);
}

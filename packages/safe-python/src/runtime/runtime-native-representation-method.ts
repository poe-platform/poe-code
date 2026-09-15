import { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";
import { integerDigits } from "./integer-digits.js";
import { floatRepresentation } from "./float-representation.js";
import { complexRepresentation } from "./complex-representation.js";
import { rangeRepresentation } from "./range-representation.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { representationObject } from "./representation-protocol.js";
import { UnsupportedExpressionError } from "./expression-evaluation.js";

type NativeRepresentationValue = Extract<RuntimeValue, { kind: "str" | "bytes" | "int" | "bool" | "float" | "complex" | "range" | "list" | "tuple" | "dict" | "set" | "frozenset" | "mappingproxy" | "slice" | "dict_keys" | "dict_values" | "dict_items" | "none" | "ellipsis" | "not-implemented" }>;

/** One capability guard shared by attribute and implicit representation lookup. */
export function hasNativeRepresentation(value: RuntimeValue): value is NativeRepresentationValue {
  return value.kind === "str" || value.kind === "bytes" || value.kind === "int" || value.kind === "bool"
    || value.kind === "set" || value.kind === "frozenset"
    || value.kind === "slice" || value.kind === "dict_keys" || value.kind === "dict_values" || value.kind === "dict_items"
    || value.kind === "float" || value.kind === "complex" || value.kind === "range" || value.kind === "list" || value.kind === "tuple" || value.kind === "dict" || value.kind === "mappingproxy" || value.kind === "none" || value.kind === "ellipsis" || value.kind === "not-implemented";
}

/** Implemented exact native slots; guest subclass dispatch and method-wrapper
 * introspection are separate from these explicitly bound native capabilities. */
export function createRuntimeNativeRepresentationMethod(receiver: NativeRepresentationValue, name: "__str__" | "__repr__", values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      return runtimeNativeRepresentation(receiver, name, values, meter, invocation);
    }
  });
}

/** Shared native slot operation, separate from explicit method argument checks. */
export function runtimeNativeRepresentation(receiver: NativeRepresentationValue, name: "__str__" | "__repr__", values: RuntimeValues, meter: ExecutionMeter, invocation?: Pick<BuiltinInvocationContext, "formatting">): RuntimeValue {
  meter.checkpoint();
  if (receiver.kind === "list" || receiver.kind === "tuple" || receiver.kind === "dict" || receiver.kind === "set" || receiver.kind === "frozenset" || receiver.kind === "mappingproxy" || receiver.kind === "slice" || receiver.kind === "dict_keys" || receiver.kind === "dict_values" || receiver.kind === "dict_items") {
    const context = invocation?.formatting ?? createRuntimeRepresentationContext(values, meter, {
      defaultRepr() { throw new UnsupportedExpressionError("attribute"); }
    });
    return representationObject(receiver, name === "__str__" ? "str" : "repr", context, meter);
  }
  if (receiver.kind === "none") return values.string("None");
  if (receiver.kind === "ellipsis") return values.string("Ellipsis");
  if (receiver.kind === "not-implemented") return values.string("NotImplemented");
  if (receiver.kind === "float") return values.string(floatRepresentation(receiver.value, meter));
  if (receiver.kind === "complex") return values.string(complexRepresentation(receiver.real, receiver.imaginary, meter));
  if (receiver.kind === "range") return values.string(rangeRepresentation(receiver.value, meter));
  if (receiver.kind === "int") return values.string(integerDigits(receiver.value, 10, meter), "fresh");
  if (receiver.kind === "bool") return values.string(receiver.value ? "True" : "False");
  if (receiver.kind === "str" && name === "__str__") return receiver;
  const text = receiver.kind === "str" ? receiver.value.repr(false, meter) : CodePointString.fromBytesRepr(receiver.value, meter);
  return values.stringPoints(text);
}

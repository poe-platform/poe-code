import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {representationObject} from "./representation-protocol.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import type {BuiltinInvocationContext, RuntimeValue, RuntimeValues, TypeValue} from "./runtime-values.js";

/** Bound native argument errors consult the receiver type's live qualname.
 * Descriptor calls use the defining owner. Resolve this only after validation
 * fails: metaclass lookup and string-subtype rendering can execute guest code. */
export function runtimeNativeMethodDiagnostic(receiver: RuntimeValue, owner: TypeValue, name: string, bound: boolean | undefined,
  values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): string {
  meter.checkpoint();
  if (!bound) return `${owner.value.name}.${name}()`;
  const type = receiver.kind === "instance" ? receiver.type : invocation?.actualType?.(receiver) ?? owner;
  try {
    const qualified = invocation?.attribute === undefined ? type.value.names.get("__qualname__", values, meter) : invocation.attribute(type, "__qualname__");
    meter.checkpoint();
    if (runtimeStringPayload(qualified) === undefined) throw new PythonRuntimeError("TypeError", "<method>.__class__.__qualname__ is not a unicode object");
    let rendered = qualified;
    if (qualified.kind !== "str") {
      if (invocation?.formatting === undefined) throw Error("native method diagnostics require a representation policy");
      rendered = representationObject(qualified, "str", invocation.formatting, meter);
    }
    const text = runtimeStringPayload(rendered);
    if (text === undefined) throw Error("native method diagnostic rendering requires string storage");
    let prefix = "";
    for (const point of text.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); prefix += String.fromCodePoint(point); }
    meter.checkpoint(0, 2 * (prefix.length + name.length + 3));
    return `${prefix}.${name}()`;
  } catch (error) {
    if (!runtimeExceptionMatches(error, "AttributeError", invocation)) throw error;
    // _PyObject_FunctionStr falls back to str(method) only for AttributeError.
    // Native method repr uses the receiver's actual type and owned identity.
    const identity = (invocation?.identity ?? values.identity).id(receiver);
    const hex = identity.toString(16), typeName = type.value.diagnosticName;
    meter.checkpoint(0, 128 + 2 * (hex.length + name.length + typeName.length));
    return `<built-in method ${name} of ${typeName} object at 0x${hex}>`;
  }
}

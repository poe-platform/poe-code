import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinInvocationContext, RuntimeValue } from "./runtime-values.js";
import { optionalLength, type LengthProtocolContext } from "./length-protocol.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { createRuntimeLengthContext } from "./runtime-length-context.js";

/** Exact-value length without iteration, with optional guest slot/index dispatch
 * for other values. Exact builtin lengths never consult or allocate the guest
 * capability. Invocation adapters are prepared only for non-native inputs. */
export function runtimeLength(value: RuntimeValue, meter: ExecutionMeter, protocol?: LengthProtocolContext<RuntimeValue>, invocation?: BuiltinInvocationContext): number | bigint {
  meter.checkpoint();
  while (value.kind === "mappingproxy") { meter.checkpoint(); value = value.value; }
  switch (value.kind) {
    case "list": case "tuple": return value.items.length;
    case "dict": case "set": case "frozenset": return value.items.size;
    case "dict_keys": case "dict_values": case "dict_items": return value.value.items.size;
    case "str": case "bytes": return value.value.length;
    case "range":
      if (BigInt.asIntN(64, value.value.length) !== value.value.length) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
      return value.value.length;
    default: {
      protocol ??= invocation === undefined ? undefined : createRuntimeLengthContext(invocation, meter);
      if (protocol !== undefined) {
        const length = optionalLength(value, protocol, meter);
        if (length !== undefined) return length;
        const name = diagnosticTypeName(protocol.typeName(value), meter);
        meter.checkpoint();
        throw new PythonRuntimeError("TypeError", `object of type '${name}' has no len()`);
      }
      const name = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
      throw new PythonRuntimeError("TypeError", `object of type '${name}' has no len()`);
    }
  }
}

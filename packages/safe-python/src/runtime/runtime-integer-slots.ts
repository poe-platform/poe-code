import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { runtimeNumericMethods } from "./runtime-numeric-slots.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeDivmod } from "./runtime-divmod.js";
import { runtimePowerSlot } from "./runtime-power.js";
import { runtimeReceiverComparison } from "./runtime-receiver-comparison.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import { integerToFloat } from "./numeric-conversion.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Native integer slots operate on owned payloads without conversion overrides.
 * Normal dispatch, including subtype reflection, stays in the object layer. */
export function installRuntimeIntegerSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  const comparisons = new Map([["__eq__", "=="], ["__ne__", "!="], ["__lt__", "<"], ["__le__", "<="], ["__gt__", ">"], ["__ge__", ">="]]);
  const unary = new Map([["__pos__", "Return +self."], ["__neg__", "Return -self."], ["__abs__", "abs(self)"], ["__invert__", "Return ~self."], ["__bool__", "True if self else False"], ["__int__", "int(self)"], ["__index__", "Return self converted to an integer, if self is suitable for use as an index into a list."], ["__float__", "float(self)"], ["__repr__", "Return repr(self)."], ["__hash__", "Return hash(self)."]]);
  for (const [name, doc] of unary) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: value => runtimeIntegerPayload(value) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
        const payload = runtimeIntegerPayload(receiver)!;
        const integer = payload.kind === "int" ? payload.value : payload.value ? 1n : 0n;
        if (name === "__bool__") return values.boolean(integer !== 0n);
        if (name === "__float__") return values.float(integerToFloat(integer));
        if (name === "__repr__") return runtimeNativeRepresentation(payload.kind === "int" ? payload : values.integer(integer), name, values, meter, invocation);
        if (name === "__hash__") {
          if (invocation?.nativeHash === undefined) throw Error("integer hashing requires a native hash policy");
          let hash: bigint;
          try { hash = invocation.nativeHash(payload); }
          catch (error) { throw error instanceof RuntimeHashError ? error.original : error; }
          meter.checkpoint(); return values.integer(hash);
        }
        if (name === "__neg__") return values.integer(-integer);
        if (name === "__invert__") return values.integer(~integer);
        if (name === "__abs__" && integer < 0n) return values.integer(-integer);
        return receiver.kind === "int" ? receiver : values.integer(integer);
      }
    }));
  }
  for (const [name, operator] of comparisons) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc: `Return self${operator}value.`, accepts: value => runtimeIntegerPayload(value) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        return runtimeReceiverComparison(operator, runtimeIntegerPayload(receiver)!, runtimeIntegerPayload(positional[0]) ?? positional[0], values, meter, undefined, invocation);
      }
    }));
  }
  for (const [operator, names] of runtimeNumericMethods) {
    if (operator === "@") continue;
    for (const reflected of [false, true]) {
      const name = reflected ? names.reflected : names.forward;
      const first = reflected ? "value" : "self", second = reflected ? "self" : "value";
      const doc = operator === "**" ? `Return pow(${first}, ${second}, mod).` : operator === "divmod()" ? `Return divmod(${first}, ${second}).` : `Return ${first}${operator}${second}.`;
      meter.checkpoint(0, 96);
      owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, textSignature: operator === "**" ? "($self, value, mod=None, /)" : "($self, value, /)", accepts: value => runtimeIntegerPayload(value) !== undefined,
        invoke(receiver, positional, keywords, meter) {
          meter.checkpoint();
          if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
          if (operator === "**") {
            if (positional.length < 1 || positional.length > 2) throw new PythonRuntimeError("TypeError", `expected 1 or 2 arguments, got ${positional.length}`);
          } else if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
          const payload = runtimeIntegerPayload(receiver)!, other = runtimeIntegerPayload(positional[0]);
          if (other === undefined) return values.notImplemented;
          const a = payload.kind === "bool" ? values.integer(payload.value ? 1 : 0) : payload;
          const b = other.kind === "bool" ? values.integer(other.value ? 1 : 0) : other;
          const left = reflected ? b : a, right = reflected ? a : b;
          if (operator === "divmod()") return runtimeDivmod(left, right, values, meter);
          if (operator === "**") {
            const argument = positional[1] ?? values.none, modulus = runtimeIntegerPayload(argument) ?? argument;
            return runtimePowerSlot(payload, left, right, modulus, values, meter);
          }
          return runtimeBinary(operator, left, right, values, meter);
        }
      }));
    }
  }
}

import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { constantUnary } from "./constant-unary.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { runtimeBinary } from "./runtime-binary.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Only boolean-specific slots are published; remaining arithmetic and numeric
 * conversions inherit int descriptors with their original owner metadata. */
export function installRuntimeBooleanSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  for (const [name, doc] of [["__repr__", "Return repr(self)."], ["__invert__", "~self"]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: value => value.kind === "bool",
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
        if (receiver.kind !== "bool") throw Error("boolean slot requires boolean storage");
        if (name === "__repr__") return values.string(receiver.value ? "True" : "False");
        return constantUnary("~", receiver, { values, warn: (category, message) => invocation?.warn?.(category, message) }, meter);
      }
    }));
  }
  for (const [suffix, operator] of [["and", "&"], ["or", "|"], ["xor", "^"]] as const) for (const reflected of [false, true]) {
    const name = `__${reflected ? "r" : ""}${suffix}__`;
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc: `Return ${reflected ? "value" : "self"}${operator}${reflected ? "self" : "value"}.`, accepts: value => value.kind === "bool",
      invoke(receiver, positional, keywords, meter) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        const other = runtimeIntegerPayload(positional[0]);
        if (other === undefined) return values.notImplemented;
        return runtimeBinary(operator, reflected ? other : receiver, reflected ? receiver : other, values, meter);
      }
    }));
  }
}

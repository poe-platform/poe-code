import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeInPlace } from "./runtime-inplace.js";
import { runtimeSetPayload } from "./runtime-set-payload.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Set numeric wrappers accept native set storage, not arbitrary iterables.
 * Reversed wrappers preserve operand orientation and the left result kind;
 * in-place wrappers retain the original (possibly subclass) receiver. */
export function installRuntimeSetOperatorSlots(kind: "set" | "frozenset", owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 256);
  for (const [suffix, operator] of [["or", "|"], ["and", "&"], ["sub", "-"], ["xor", "^"]] as const) {
    for (const mode of kind === "set" ? ["", "r", "i"] : ["", "r"]) {
      const name = `__${mode}${suffix}__`, expression = mode === "r" ? `value${operator}self` : `self${operator}${mode === "i" ? "=" : ""}value`;
      meter.checkpoint(0, 128);
      owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc: `Return ${expression}.`, accepts: receiver => runtimeSetPayload(receiver)?.kind === kind,
        invoke(receiver, positional, keywords, meter) {
          meter.checkpoint();
          if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
          if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
          const payload = runtimeSetPayload(receiver), other = runtimeSetPayload(positional[0]);
          if (payload === undefined) throw Error("set operator requires native storage");
          if (other === undefined) return values.notImplemented;
          if (mode === "i") {
            runtimeInPlace(operator, payload, other, values, meter);
            return receiver;
          }
          return mode === "r" ? runtimeBinary(operator, other, payload, values, meter) : runtimeBinary(operator, payload, other, values, meter);
        }
      }));
    }
  }
}

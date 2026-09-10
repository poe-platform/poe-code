import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeBinary } from "./runtime-binary.js";
import { updateRuntimeDictionary } from "./runtime-dictionary-update.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Ordinary union accepts dictionaries only; in-place union accepts update
 * sources, retaining partial writes and the active guest mapping protocols. */
export function installRuntimeDictionaryOperatorSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 128);
  for (const [name, expression] of [["__or__", "self|value"], ["__ror__", "value|self"], ["__ior__", "self|=value"]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc: `Return ${expression}.`, accepts: receiver => receiver.kind === "dict",
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        if (receiver.kind !== "dict") throw Error("dictionary operator requires dictionary storage");
        const other = positional[0];
        if (name === "__ior__") {
          updateRuntimeDictionary(receiver, other, values, meter, invocation);
          return receiver;
        }
        if (other.kind !== "dict") return values.notImplemented;
        return name === "__ror__" ? runtimeBinary("|", other, receiver, values, meter) : runtimeBinary("|", receiver, other, values, meter);
      }
    }));
  }
}

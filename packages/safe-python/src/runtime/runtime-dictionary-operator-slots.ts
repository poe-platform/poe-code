import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeBinary } from "./runtime-binary.js";
import { updateRuntimeDictionary } from "./runtime-dictionary-update.js";
import { runtimeDictionaryPayload } from "./runtime-dictionary-payload.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Ordinary union accepts dictionaries only; in-place union accepts update
 * sources, retaining partial writes and the active guest mapping protocols. */
export function installRuntimeDictionaryOperatorSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 128);
  for (const [name, expression] of [["__or__", "self|value"], ["__ror__", "value|self"], ["__ior__", "self|=value"]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc: `Return ${expression}.`, accepts: receiver => runtimeDictionaryPayload(receiver) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        const payload = runtimeDictionaryPayload(receiver);
        if (payload === undefined) throw Error("dictionary operator requires dictionary storage");
        const other = positional[0];
        if (name === "__ior__") {
          updateRuntimeDictionary(payload, other, values, meter, invocation);
          return receiver;
        }
        const right = runtimeDictionaryPayload(other);
        if (right === undefined) return values.notImplemented;
        if (receiver.kind === "dict" && other.kind === "dict") return name === "__ror__" ? runtimeBinary("|", right, payload, values, meter) : runtimeBinary("|", payload, right, values, meter);
        const result = values.dictionary(payload.items.emptyCopy());
        updateRuntimeDictionary(result, name === "__ror__" ? other : receiver, values, meter, invocation);
        updateRuntimeDictionary(result, name === "__ror__" ? receiver : other, values, meter, invocation);
        return result;
      }
    }));
  }
}

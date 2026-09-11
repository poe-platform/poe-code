import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeReceiverComparison } from "./runtime-receiver-comparison.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import { runtimeSetPayload } from "./runtime-set-payload.js";
import { runtimeTuplePayload } from "./runtime-tuple-payload.js";
import { runtimeDictionaryPayload } from "./runtime-dictionary-payload.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

export type NativeBoundCallableKind = "method" | "method-wrapper" | "builtin_function_or_method";

/** Native comparison slots belong to their defining types. Callable equality
 * retains binding identities; list slots compare live storage and can return
 * raw guest ordering results. Member comparison uses the active execution. */
export function installRuntimeComparisonMethods(kind: NativeBoundCallableKind | "dict" | "list" | "tuple" | "set" | "frozenset" | "slice" | "cell" | "none", owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 256);
  const slots = [["__eq__", "=="], ["__ne__", "!="]];
  if (kind === "list" || kind === "tuple" || kind === "set" || kind === "frozenset" || kind === "slice" || kind === "cell" || kind === "none") slots.push(["__lt__", "<"], ["__le__", "<="], ["__gt__", ">"], ["__ge__", ">="]);
  for (const [name, operator] of slots) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc: `Return self${operator}value.`, accepts: receiver => kind === "dict" ? runtimeDictionaryPayload(receiver) !== undefined : kind === "list" ? runtimeListPayload(receiver) !== undefined : kind === "tuple" ? runtimeTuplePayload(receiver) !== undefined : kind === "set" || kind === "frozenset" ? runtimeSetPayload(receiver)?.kind === kind : receiver.kind === kind,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        const left = kind === "dict" ? runtimeDictionaryPayload(receiver)! : kind === "list" ? runtimeListPayload(receiver)! : kind === "tuple" ? runtimeTuplePayload(receiver)! : kind === "set" || kind === "frozenset" ? runtimeSetPayload(receiver)! : receiver;
        const right = kind === "dict" ? runtimeDictionaryPayload(positional[0]) ?? positional[0] : kind === "list" ? runtimeListPayload(positional[0]) ?? positional[0] : kind === "tuple" ? runtimeTuplePayload(positional[0]) ?? positional[0] : kind === "set" || kind === "frozenset" ? runtimeSetPayload(positional[0]) ?? positional[0] : positional[0];
        return runtimeReceiverComparison(operator, left, right, values, meter, undefined, invocation);
      }
    }));
  }
}

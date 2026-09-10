import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeReceiverComparison } from "./runtime-receiver-comparison.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

export type NativeBoundCallableKind = "method" | "method-wrapper" | "builtin_function_or_method";

/** Native comparison slots belong to their defining types. Callable equality
 * retains binding identities; list slots compare live storage and can return
 * raw guest ordering results. Member comparison uses the active execution. */
export function installRuntimeComparisonMethods(kind: NativeBoundCallableKind | "list", owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 256);
  const slots = [["__eq__", "=="], ["__ne__", "!="]];
  if (kind === "list") slots.push(["__lt__", "<"], ["__le__", "<="], ["__gt__", ">"], ["__ge__", ">="]);
  for (const [name, operator] of slots) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc: `Return self${operator}value.`, accepts: receiver => kind === "list" ? runtimeListPayload(receiver) !== undefined : receiver.kind === kind,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        return runtimeReceiverComparison(operator, kind === "list" ? runtimeListPayload(receiver)! : receiver, kind === "list" ? runtimeListPayload(positional[0]) ?? positional[0] : positional[0], values, meter, undefined, invocation);
      }
    }));
  }
}

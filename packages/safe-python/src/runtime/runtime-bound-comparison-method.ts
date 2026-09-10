import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeReceiverComparison } from "./runtime-receiver-comparison.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

export type NativeBoundCallableKind = "method" | "method-wrapper" | "builtin_function_or_method";

/** Native callable equality belongs to its defining type, not object.__eq__.
 * Methods compare function/receiver bindings; native wrappers retain their
 * implementation/receiver identities. Member equality can still invoke guests. */
export function installRuntimeBoundComparisonMethods(kind: NativeBoundCallableKind, owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 96);
  for (const [name, operator] of [["__eq__", "=="], ["__ne__", "!="]]) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc: `Return self${operator}value.`, accepts: receiver => receiver.kind === kind,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        return runtimeReceiverComparison(operator, receiver, positional[0], values, meter, undefined, invocation);
      }
    }));
  }
}

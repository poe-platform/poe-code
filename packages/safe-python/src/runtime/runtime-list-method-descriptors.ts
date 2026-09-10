import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { createRuntimeListMethod } from "./runtime-list-method.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Canonical list method definitions supply stable implementation identities.
 * Per-call adapters retain active guest iteration/equality/index capabilities. */
export function installRuntimeListMethodDescriptors(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 128);
  for (const name of ["append", "extend", "insert", "pop", "clear", "reverse", "copy", "count", "remove", "index", "__reversed__"] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, accepts: receiver => receiver.kind === "list",
      invoke(receiver, positional, keywords, meter, invocation) {
        if (receiver.kind !== "list") throw Error("list method requires list storage");
        meter.checkpoint(0, 96);
        const method = createRuntimeListMethod(receiver, name, values, meter, {
          compare: invocation?.compare?.bind(invocation), truth: invocation?.truth?.bind(invocation), integerIndex: invocation?.integerIndex,
          iterate: (value, notIterable, hint) => runtimeIterate(value, values, meter, invocation?.iteration, notIterable, hint)
        });
        return method.value.invoke(positional, keywords, meter, invocation);
      }
    }));
  }
}

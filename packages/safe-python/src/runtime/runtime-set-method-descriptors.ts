import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeSetAlgebraMethod } from "./runtime-set-algebra-method.js";
import { createRuntimeSetMutationMethod } from "./runtime-set-mutation-method.js";
import { createRuntimeSetRelationMethod } from "./runtime-set-relation-method.js";
import { runtimeSetPayload } from "./runtime-set-payload.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Bind canonical native methods to the original receiver, keeping guest
 * overrides separate from the storage consumed by explicit base methods. */
export function installRuntimeSetMethodDescriptors(kind: "set" | "frozenset", owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  const names = ["copy", "isdisjoint", "issubset", "issuperset", "union", "intersection", "difference", "symmetric_difference",
    ...(kind === "set" ? ["add", "remove", "discard", "pop", "clear", "update", "intersection_update", "difference_update", "symmetric_difference_update"] as const : [])] as const;
  meter.checkpoint(0, 128);
  for (const name of names) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, accepts: receiver => runtimeSetPayload(receiver)?.kind === kind,
      invoke(receiver, positional, keywords, meter, invocation) {
        const payload = runtimeSetPayload(receiver);
        if (payload === undefined || payload.kind !== kind) throw Error("set method requires matching native storage");
        let method;
        switch (name) {
          case "copy": case "isdisjoint": case "issubset": case "issuperset":
            method = createRuntimeSetRelationMethod(payload, name, values, meter, receiver); break;
          case "union": case "intersection": case "difference": case "symmetric_difference":
            method = createRuntimeSetAlgebraMethod(payload, name, values, meter); break;
          default:
            if (payload.kind !== "set") throw Error("mutable set method requires mutable storage");
            method = createRuntimeSetMutationMethod(payload, name, values, meter);
        }
        return method.value.invoke(positional, keywords, meter, invocation);
      }
    }));
  }
}

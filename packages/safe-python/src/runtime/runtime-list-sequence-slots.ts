import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeSearchEquality } from "./runtime-search-equality.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** List sequence slots operate on live owned storage; membership preserves
 * element identity shortcuts and the current execution's guest protocols. */
export function installRuntimeListSequenceSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 192);
  for (const [name, doc] of [["__len__", "Return len(self)."], ["__iter__", "Implement iter(self)."], ["__contains__", "Return bool(key in self)."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "list",
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (receiver.kind !== "list") throw Error("list sequence slot requires list storage");
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        const count = name === "__contains__" ? 1 : 0;
        if (positional.length !== count) throw new PythonRuntimeError("TypeError", `expected ${count} argument${count === 1 ? "" : "s"}, got ${positional.length}`);
        if (name === "__len__") return values.integer(receiver.items.length);
        if (name === "__iter__") return values.iterator(receiver.items.iterate());
        const equal = createRuntimeSearchEquality(values, meter, { compare: invocation?.compare?.bind(invocation), truth: invocation?.truth?.bind(invocation) });
        return values.boolean(receiver.items.indexOf(positional[0], equal) !== undefined);
      }
    }));
  }
}

import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeMutateItem } from "./runtime-mutation.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Explicit list subscriptions share the expression kernels, including guest
 * index conversion and materialization of iterable slice replacements. */
export function installRuntimeListSubscriptionSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 192);
  owner.value.namespace.items.set(values.string("__getitem__"), values.methodDescriptor({ owner, name: "__getitem__", doc: "Return self[index].", accepts: receiver => runtimeListPayload(receiver) !== undefined,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "list.__getitem__() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `list.__getitem__() takes exactly one argument (${positional.length} given)`);
      const list = runtimeListPayload(receiver);
      if (list === undefined) throw Error("list subscription requires list storage");
      return runtimeIndex(list, positional[0], values, meter, invocation?.integerIndex);
    }
  }));
  for (const [name, doc] of [["__setitem__", "Set self[key] to value."], ["__delitem__", "Delete self[key]."]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: receiver => runtimeListPayload(receiver) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        if (name === "__setitem__" && positional.length !== 2) throw new PythonRuntimeError("TypeError", `__setitem__ expected 2 arguments, got ${positional.length}`);
        if (name === "__delitem__" && positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
        meter.checkpoint(0, 64);
        const list = runtimeListPayload(receiver);
        if (list === undefined) throw Error("list subscription requires list storage");
        runtimeMutateItem(list, positional[0], name === "__setitem__" ? { kind: "set", value: positional[1] } : { kind: "delete" }, values, meter, invocation?.integerIndex,
          (value, notIterable, hint) => runtimeIterate(value, values, meter, invocation?.iteration, notIterable, hint));
        return values.none;
      }
    }));
  }
}

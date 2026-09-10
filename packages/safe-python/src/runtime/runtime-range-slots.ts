import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeReceiverComparison } from "./runtime-receiver-comparison.js";
import { runtimeLength } from "./runtime-length.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeMembership } from "./runtime-membership.js";
import { createRuntimeRangeIterator } from "./runtime-range-iterator.js";
import { callRuntimeRangeMethod } from "./runtime-range-attributes.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Range descriptors use progression arithmetic without materializing members.
 * Only len applies the signed machine-size limit to the range's cardinality. */
export function installRuntimeRangeSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  for (const name of ["start", "stop", "step"] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.memberDescriptor({ owner, name, accepts: receiver => receiver.kind === "range",
      get(receiver, meter) {
        meter.checkpoint();
        if (receiver.kind !== "range") throw Error("range member requires range storage");
        return values.integer(receiver.value[name]);
      }
    }));
  }
  const comparisons = new Map([["__eq__", "=="], ["__ne__", "!="], ["__lt__", "<"], ["__le__", "<="], ["__gt__", ">"], ["__ge__", ">="]]);
  const slots = [["__len__", "Return len(self)."], ["__bool__", "True if self else False"], ["__iter__", "Implement iter(self)."],
    ["__getitem__", "Return self[key]."], ["__contains__", "Return bool(key in self)."], ["__repr__", "Return repr(self)."], ["__hash__", "Return hash(self)."]];
  for (const [name, operator] of comparisons) slots.push([name, `Return self${operator}value.`]);
  for (const [name, doc] of slots) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.wrapperDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "range",
      invoke(receiver, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
        const operator = comparisons.get(name), count = operator !== undefined || name === "__getitem__" || name === "__contains__" ? 1 : 0;
        if (positional.length !== count) throw new PythonRuntimeError("TypeError", `expected ${count} argument${count === 1 ? "" : "s"}, got ${positional.length}`);
        if (receiver.kind !== "range") throw Error("range slot requires range storage");
        if (operator !== undefined) return runtimeReceiverComparison(operator, receiver, positional[0], values, meter, undefined, invocation);
        if (name === "__bool__") return values.boolean(receiver.value.length !== 0n);
        if (name === "__len__") return values.integer(runtimeLength(receiver, meter));
        if (name === "__iter__") return values.iterator(createRuntimeRangeIterator(receiver.value, false, values, meter));
        if (name === "__getitem__") return runtimeIndex(receiver, positional[0], values, meter, invocation?.integerIndex);
        if (name === "__contains__") return runtimeMembership("in", positional[0], receiver, values, meter, undefined, invocation);
        if (name === "__repr__") return runtimeNativeRepresentation(receiver, name, values, meter, invocation);
        if (invocation?.nativeHash === undefined) throw Error("range hashing requires a native hash policy");
        let hash: bigint;
        try { hash = invocation.nativeHash(receiver); }
        catch (error) { throw error instanceof RuntimeHashError ? error.original : error; }
        meter.checkpoint(); return values.integer(hash);
      }
    }));
  }
  for (const [name, doc] of [["count", "rangeobject.count(value) -> integer -- return number of occurrences of value"], ["index", "rangeobject.index(value) -> integer -- return index of value.\nRaise ValueError if the value is not present."], ["__reversed__", "Return a reverse iterator."], ["__reduce__", undefined]] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "range",
      invoke(receiver, positional, keywords, meter, invocation) {
        if (receiver.kind !== "range") throw Error("range method requires range storage");
        if (name !== "__reduce__") return callRuntimeRangeMethod(receiver, name, positional, keywords, values, meter, invocation);
        if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "range.__reduce__() takes no keyword arguments");
        if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `range.__reduce__() takes no arguments (${positional.length} given)`);
        return values.tuple([owner, values.tuple([values.integer(receiver.value.start), values.integer(receiver.value.stop), values.integer(receiver.value.step)])]);
      }
    }));
  }
}

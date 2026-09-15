import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import { createRuntimeListMethod } from "./runtime-list-method.js";
import { createRuntimeListSortMethod } from "./runtime-list-sort-method.js";
import { runtimeNativeMethodDiagnostic } from "./runtime-native-method-diagnostic.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Canonical list method definitions supply stable implementation identities.
 * Per-call adapters retain active guest iteration/equality/index capabilities. */
export function installRuntimeListMethodDescriptors(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 128);
  for (const [name, doc, textSignature] of [
    ["append", "Append object to the end of the list.", "($self, object, /)"],
    ["extend", "Extend list by appending elements from the iterable.", "($self, iterable, /)"],
    ["insert", "Insert object before index.", "($self, index, object, /)"],
    ["pop", "Remove and return item at index (default last).\n\nRaises IndexError if list is empty or index is out of range.", "($self, index=-1, /)"],
    ["clear", "Remove all items from list.", "($self, /)"],
    ["reverse", "Reverse *IN PLACE*.", "($self, /)"],
    ["copy", "Return a shallow copy of the list.", "($self, /)"],
    ["count", "Return number of occurrences of value.", "($self, value, /)"],
    ["remove", "Remove first occurrence of value.\n\nRaises ValueError if the value is not present.", "($self, value, /)"],
    ["index", "Return first index of value.\n\nRaises ValueError if the value is not present.", "($self, value, start=0, stop=sys.maxsize, /)"],
    ["__reversed__", "Return a reverse iterator over the list.", "($self, /)"],
    ["sort", "Sort the list in ascending order and return None.\n\nThe sort is in-place (i.e. the list itself is modified) and stable\n(i.e. the order of two equal elements is maintained).\n\nIf a key function is given, apply it once to each list item and sort\nthem, ascending or descending, according to their function values.\n\nThe reverse flag can be set to sort in descending order.", "($self, /, *, key=None, reverse=False)"]
  ] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, textSignature, accepts: receiver => runtimeListPayload(receiver) !== undefined,
      invoke(receiver, positional, keywords, meter, invocation, bound) {
        const list = runtimeListPayload(receiver);
        if (list === undefined) throw Error("list method requires list storage");
        meter.checkpoint(0, 96);
        const method = name === "sort" ? createRuntimeListSortMethod(list, values, meter) : createRuntimeListMethod(list, name, values, meter, {
          diagnosticName: () => runtimeNativeMethodDiagnostic(receiver, owner, name, bound, values, meter, invocation),
          compare: invocation?.compare?.bind(invocation), truth: invocation?.truth?.bind(invocation), integerIndex: invocation?.integerIndex,
          iterate: (value, notIterable, hint) => runtimeIterate(value, values, meter, invocation?.iteration, notIterable, hint)
        });
        return method.value.invoke(positional, keywords, meter, invocation);
      }
    }));
  }
}

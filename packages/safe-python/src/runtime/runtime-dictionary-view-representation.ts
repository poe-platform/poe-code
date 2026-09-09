import { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { listRepresentation } from "./list-representation.js";
import type { RepresentationContext } from "./representation-protocol.js";
import type { RepresentationStack } from "./representation-stack.js";
import { iterateRuntimeDictionaryView } from "./runtime-dictionary-view.js";
import type { DictionaryViewValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

const prefixes = {
  dict_keys: Uint32Array.from("dict_keys(", point => point.charCodeAt(0)),
  dict_values: Uint32Array.from("dict_values(", point => point.charCodeAt(0)),
  dict_items: Uint32Array.from("dict_items(", point => point.charCodeAt(0))
};
const recursive = Uint32Array.of(46, 46, 46), suffix = Uint32Array.of(41), empty = new Uint32Array(0);

/** Guard the view before snapshotting, including empty views. Element repr
 * runs only after the complete shallow list (and item tuples) is captured.
 * Mutations during rendering therefore cannot change the captured entries.
 */
export function runtimeDictionaryViewRepresentation(view: DictionaryViewValue, values: RuntimeValues, context: RepresentationContext<RuntimeValue>, stack: RepresentationStack<RuntimeValue>, meter: ExecutionMeter): CodePointString {
  meter.checkpoint();
  const leave = stack.enter(view);
  if (leave === undefined) return new CodePointString(recursive, meter);
  try {
    meter.checkpoint(0, 64);
    const snapshot = values.list([]), iterator = iterateRuntimeDictionaryView(view, values, meter);
    for (;;) {
      const item = iterator.next(); meter.checkpoint();
      if (item.done) break;
      snapshot.items.append(item.value);
    }
    const storage = listRepresentation(snapshot, snapshot.items, context, stack, meter);
    meter.checkpoint(0, 64);
    return new CodePointString(empty, meter).join([
      new CodePointString(prefixes[view.kind], meter), storage, new CodePointString(suffix, meter)
    ], meter);
  } finally { leave(); }
}

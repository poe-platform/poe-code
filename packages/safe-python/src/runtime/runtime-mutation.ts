import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ListStorage } from "./list-storage.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeSliceBounds } from "./runtime-slice-bounds.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import { runtimeSequenceIndex } from "./runtime-sequence-index.js";

export type ItemMutation = { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" };

/** Exact builtin mutation. Iterable replacements are fully materialized before
 * changing slots, then slice normalization sees any iterator-driven mutations.
 * No implicit iterator close or rollback of callback effects. Guest slots,
 * length-hint dispatch and finalizer behavior remain object-runtime concerns.
 */
export function runtimeMutateItem(object: RuntimeValue, key: RuntimeValue, change: ItemMutation, values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): void {
  meter.checkpoint();
  if (object.kind === "dict") { runtimeDictionaryAccess(object, key, change, meter); return; }
  if (object.kind !== "list") {
    const name = object.kind === "none" ? "NoneType" : object.kind === "not-implemented" ? "NotImplementedType" : object.kind;
    const immutableSequence = object.kind === "tuple" || object.kind === "str" || object.kind === "bytes" || object.kind === "range";
    const verb = change.kind === "delete" && immutableSequence ? "doesn't" : "does not";
    throw new PythonRuntimeError("TypeError", `'${name}' object ${verb} support item ${change.kind === "set" ? "assignment" : "deletion"}`);
  }
  if (key.kind === "slice") {
    const { start, stop, step } = runtimeSliceBounds(key, meter, context);
    if (change.kind === "delete") { object.items.deleteSlice(start, stop, step); return; }
    let replacement: ListStorage<RuntimeValue>;
    if (change.value.kind === "list") replacement = change.value.items;
    else if (change.value.kind === "tuple") replacement = new ListStorage(change.value.items, meter);
    else {
      let iterator: Iterator<RuntimeValue>;
      try { iterator = runtimeIterate(change.value, values, meter); }
      catch (error) {
        if (error instanceof PythonRuntimeError && error.name === "TypeError") throw new PythonRuntimeError("TypeError", "must assign iterable to extended slice");
        throw error;
      }
      replacement = new ListStorage<RuntimeValue>([], meter);
      replacement.extendIterator(iterator);
    }
    object.items.setSlice(start, stop, step, replacement);
    return;
  }
  const index = runtimeSequenceIndex("list", key, meter, context);
  if (change.kind === "delete") object.items.delete(index);
  else object.items.set(index, change.value);
}

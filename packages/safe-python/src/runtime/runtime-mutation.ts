import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ListStorage } from "./list-storage.js";
import { runtimeSliceBounds } from "./runtime-slice-bounds.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import { runtimeSequenceIndex } from "./runtime-sequence-index.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { runtimeSequenceIterator } from "./runtime-sequence-iterator.js";

export type ItemMutation = { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" };

/** Exact builtin mutation. Iterable replacements are fully materialized before
 * changing slots, then slice normalization sees any iterator-driven mutations.
 * No implicit iterator close or rollback of callback effects. Guest iteration
 * reacquires the returned cursor and requests its hint before collection.
 * Subscription override slots and finalizers remain object-runtime concerns.
 */
export function runtimeMutateItem(object: RuntimeValue, key: RuntimeValue, change: ItemMutation, values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>, iterate?: ExpressionContext<RuntimeValue>["iterate"], invocation?: Pick<BuiltinInvocationContext, "isException">): void {
  meter.checkpoint();
  if (object.kind === "dict") { runtimeDictionaryAccess(object, key, change, meter); return; }
  if (object.kind !== "list") {
    const name = object.kind === "none" ? "NoneType" : object.kind === "not-implemented" ? "NotImplementedType" : object.kind;
    const sequenceTable = object.kind === "tuple" || object.kind === "str" || object.kind === "bytes" || object.kind === "range" || object.kind === "set" || object.kind === "frozenset" || object.kind === "dict_keys" || object.kind === "dict_values" || object.kind === "dict_items";
    const verb = change.kind === "delete" && sequenceTable ? "doesn't" : "does not";
    throw new PythonRuntimeError("TypeError", `'${name}' object ${verb} support item ${change.kind === "set" ? "assignment" : "deletion"}`);
  }
  if (key.kind === "slice") {
    const { start, stop, step } = runtimeSliceBounds(key, meter, context);
    if (change.kind === "delete") { object.items.deleteSlice(start, stop, step); return; }
    let replacement: ListStorage<RuntimeValue>;
    if (change.value.kind === "list") replacement = change.value.items;
    else if (change.value.kind === "tuple") replacement = new ListStorage(change.value.items, meter);
    else {
      const iterator = runtimeSequenceIterator(change.value, values, meter, "must assign iterable to extended slice", iterate, invocation);
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

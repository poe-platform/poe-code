import type { ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { isRuntimeSet, type DictionaryViewValue, type FrozenSetValue, type RuntimeValue, type SetValue } from "./runtime-values.js";
import { runtimeSetAccess } from "./runtime-set.js";

/** Capture the cursor now, but construct item tuples and read values on next(). */
export function iterateRuntimeDictionaryView(view: DictionaryViewValue, values: ConstantValues, meter: ExecutionMeter, reverse = false): Iterator<RuntimeValue> {
  meter.checkpoint(1, 64);
  const project = (key: RuntimeValue, value: RuntimeValue): RuntimeValue => {
    meter.checkpoint();
    return view.kind === "dict_keys" ? key : view.kind === "dict_values" ? value : values.tuple<RuntimeValue>([key, value]);
  };
  return reverse ? view.value.items.reversed(project) : view.value.items.iterate(project);
}

/** Yield equality work to the caller's depth-limited evaluator instead of
 * recursively invoking it here. Item membership hashes only the tuple's key.
 */
export function* containsRuntimeDictionaryView(view: DictionaryViewValue, needle: RuntimeValue, meter: ExecutionMeter): Generator<readonly [RuntimeValue, RuntimeValue], boolean, boolean> {
  meter.checkpoint(1, 64);
  if (view.kind === "dict_keys") return runtimeDictionaryAccess(view.value, needle, "contains", meter);
  if (view.kind === "dict_items") {
    if (needle.kind !== "tuple" || needle.items.length !== 2) return false;
    const found = runtimeDictionaryAccess(view.value, needle.items[0], "lookup", meter);
    if (found === undefined) return false;
    const item = needle.items[1];
    if (found.value === item) return true;
    meter.checkpoint(0, 32);
    return yield [found.value, item];
  }
  const iterator = view.value.items.iterate((_key, value) => value);
  for (let item = iterator.next(); !item.done; item = iterator.next()) {
    meter.checkpoint();
    if (item.value === needle) return true;
    meter.checkpoint(0, 32);
    if (yield [item.value, needle]) return true;
  }
  return false;
}

/** Set-like view/set comparison. Values views are dispatched separately.
 * Membership permits unhashable item values and cross-kind views.
 */
export function* compareRuntimeDictionaryViews(operator: string, left: DictionaryViewValue | SetValue | FrozenSetValue, right: DictionaryViewValue | SetValue | FrozenSetValue, values: ConstantValues, meter: ExecutionMeter): Generator<readonly [RuntimeValue, RuntimeValue], boolean, boolean> {
  meter.checkpoint(1, 64);
  // A set declines non-set operands, so the view's reflected slot owns the
  // operation. This affects which membership path can raise on item values.
  if (isRuntimeSet(left) && !isRuntimeSet(right)) {
    const original = left; left = right; right = original;
    operator = operator === "<" ? ">" : operator === ">" ? "<" : operator === "<=" ? ">=" : operator === ">=" ? "<=" : operator;
  }
  const aSize = (isRuntimeSet(left) ? left : left.value).items.size, bSize = (isRuntimeSet(right) ? right : right.value).items.size;
  if ((operator === "==" || operator === "!=") && aSize !== bSize) return operator === "!=";
  if ((operator === "<" && aSize >= bSize) || (operator === "<=" && aSize > bSize) ||
      (operator === ">" && aSize <= bSize) || (operator === ">=" && aSize < bSize)) return false;
  const reverse = operator === ">" || operator === ">=", source = reverse ? right : left, target = reverse ? left : right;
  const iterator = isRuntimeSet(source) ? source.items.iterate(key => key, "set") : iterateRuntimeDictionaryView(source, values, meter);
  for (let item = iterator.next(); !item.done; item = iterator.next()) {
    meter.checkpoint();
    const found = isRuntimeSet(target) ? runtimeSetAccess(target, item.value, "contains", values, meter) : (yield* containsRuntimeDictionaryView(target, item.value, meter));
    if (!found) return operator === "!=";
  }
  return operator !== "!=";
}

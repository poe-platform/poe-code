import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

export interface ClassBasesContext<Value> {
  /** Internal tuple/subclass storage, or undefined for a non-tuple. */
  tupleItems(value: Value): readonly Value[] | undefined;
  /** Actual type flag, not a virtual isinstance or __class__ lookup. */
  isType(value: Value): boolean;
  /** Ordinary bound __mro_entries__ attribute lookup. Only AttributeError means
   * absent; other failures propagate. The wrapper preserves any hook value.
   */
  lookup(value: Value): { readonly value: Value } | undefined;
  call(hook: Value, originalBases: Value): Value;
  /** Prepare sequence-fast expansion: obtain a tuple subclass's guest iterator,
   * then prepare list-extension of that iterator, including its __iter__ and length
   * hint protocols (not the original tuple subclass's __len__).
   * Exact tuples may use an internal fast path without guest protocol calls.
   * Protocol operations and allocation hints must be metered inside the adapter.
   */
  iterateTuple(value: Value): Iterator<Value>;
  tuple(values: readonly Value[]): Value;
}

/** Resolve an already assembled class-header bases tuple before metaclass
 * selection. Every hook receives the same original tuple; replacement entries
 * are not resolved again or required to be types at this stage. changed controls
 * whether class construction installs __orig_bases__, even if contents match.
 * No hook means original identity is preserved. Complete temporary-list and tuple
 * allocation accounting remains a runtime responsibility.
 */
export function resolveClassBases<Value>(
  original: Value, context: ClassBasesContext<Value>, meter: ExecutionMeter
): { readonly bases: Value; readonly changed: boolean } {
  meter.checkpoint();
  const items = context.tupleItems(original);
  if (items === undefined) throw new Error("class bases must be an assembled tuple");
  let resolved: Value[] | undefined;
  for (let index = 0; index < items.length; index++) {
    meter.checkpoint();
    const base = items[index];
    const hook = context.isType(base) ? undefined : context.lookup(base);
    if (hook === undefined) {
      resolved?.push(base);
      continue;
    }
    meter.checkpoint();
    const replacement = context.call(hook.value, original);
    if (context.tupleItems(replacement) === undefined)
      throw new PythonRuntimeError("TypeError", "__mro_entries__ must return a tuple");
    if (resolved === undefined) {
      resolved = [];
      for (let prefix = 0; prefix < index; prefix++) { meter.checkpoint(); resolved.push(items[prefix]); }
    }
    meter.checkpoint();
    const iterator = context.iterateTuple(replacement);
    while (true) {
      meter.checkpoint();
      const next = iterator.next();
      if (next.done) break;
      resolved.push(next.value);
    }
  }
  if (resolved === undefined) return { bases: original, changed: false };
  meter.checkpoint();
  return { bases: context.tuple(resolved), changed: true };
}

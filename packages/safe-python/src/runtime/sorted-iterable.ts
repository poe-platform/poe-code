import type { ExecutionMeter } from "./execution-budget.js";
import { extendList, type ListExtensionContext } from "./list-extension.js";
import { ListStorage } from "./list-storage.js";
import type { StableSortContext } from "./stable-sort.js";

/** Materialize sorted's source before binding list.sort options or converting
 * reverse to guest truth. Key invocation remains lazy until sorting actually
 * visits an element, so an empty source never calls even a non-callable key.
 * The result owns its slots; source objects/element identities remain shared.
 * The caller validates sorted's positional arity before invoking this operation
 * and supplies guest keyword/truth/key dispatch through prepareSort. Guest list
 * object wrapping and the underlying sort/hint implementation gaps remain open.
 */
export function sortedIterable<Value, Key>(source: Value, context: ListExtensionContext<Value>, prepareSort: () => StableSortContext<Value, Key>, meter: ExecutionMeter): ListStorage<Value> {
  meter.checkpoint();
  const result = new ListStorage<Value>([], meter);
  extendList(result, source, context, meter);
  const options = prepareSort();
  meter.checkpoint();
  result.sort(options);
  return result;
}

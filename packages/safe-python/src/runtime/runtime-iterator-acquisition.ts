import type { ExecutionMeter } from "./execution-budget.js";
import { resolveIteration, type IterationContext } from "./protocol-iterator.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { SequenceIterator } from "./sequence-iterator.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

const nativeIteratorNames={list:"list_iterator",tuple:"tuple_iterator",str:"str_iterator",bytes:"bytes_iterator",
  dict:"dict_keyiterator",mappingproxy:"dict_keyiterator",dict_keys:"dict_keyiterator",dict_values:"dict_valueiterator",
  dict_items:"dict_itemiterator",set:"set_iterator",frozenset:"set_iterator"} as const;

/** Acquire the guest iterator object, retaining its identity for later ordinary
 * attribute lookup. Exact native containers and legacy sequences get explicit
 * iterator values; guest __iter__ results are not wrapped in host adapters. */
export function acquireRuntimeIterator(source:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,protocol?:IterationContext<RuntimeValue>):RuntimeValue {
  switch(source.kind) {
    case "iterator":return source;
    case "list":case "tuple":case "str":case "bytes":case "range":
    case "dict":case "mappingproxy":case "dict_keys":case "dict_values":
    case "dict_items":case "set":case "frozenset":
      return values.iterator(runtimeIterate(source,values,meter),source.kind==="range"?undefined:nativeIteratorNames[source.kind]);
  }
  if(protocol===undefined)return values.iterator(runtimeIterate(source,values,meter));
  const resolved=resolveIteration(source,protocol,meter);
  return resolved.sequence?values.iterator(new SequenceIterator(resolved.value,protocol,meter)):resolved.value;
}

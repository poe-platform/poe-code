import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface AwaitableContext<Value> {
  /** Inspect native storage/code flags, never guest instance/subclass hooks. */
  nativeKind(value:Value):"coroutine"|"iterable-coroutine"|undefined;
  /** Special lookup and binding on the actual type. Undefined means absent;
   * explicitly non-callable slots and descriptor failures must propagate. */
  lookupAwait(value:Value):(()=>Value)|undefined;
  hasNext(value:Value):boolean;
  typeName(value:Value):string;
}

/** Validate an await operand without iterating or advancing the result. Unlike
 * iter(), __await__ acquisition must never invoke the returned object's __iter__.
 * Native coroutines and generator-based coroutines enter delegation directly. */
export function acquireAwaitableIterator<Value>(value:Value,context:AwaitableContext<Value>,meter:ExecutionMeter):Value {
  meter.checkpoint();
  const native=context.nativeKind(value);meter.checkpoint();
  if(native!==undefined)return value;
  const method=context.lookupAwait(value);meter.checkpoint();
  if(method===undefined) {
    const name=context.typeName(value);meter.checkpoint();
    throw new PythonRuntimeError("TypeError",`'${name}' object can't be awaited`);
  }
  const iterator=method();meter.checkpoint();
  const returnedKind=context.nativeKind(iterator);meter.checkpoint();
  if(returnedKind!==undefined)throw new PythonRuntimeError("TypeError","__await__() returned a coroutine");
  const valid=context.hasNext(iterator);meter.checkpoint();
  if(!valid) {
    const name=context.typeName(iterator);meter.checkpoint();
    throw new PythonRuntimeError("TypeError",`__await__() returned non-iterator of type '${name}'`);
  }
  return iterator;
}

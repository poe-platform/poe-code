import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";

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
  let native:ReturnType<AwaitableContext<Value>["nativeKind"]>;
  try {native=context.nativeKind(value);}finally{meter.checkpoint();}
  if(native!==undefined)return value;
  let method:(()=>Value)|undefined;
  try {method=context.lookupAwait(value);}finally{meter.checkpoint();}
  if(method===undefined) {
    let name:string;try{name=context.typeName(value);}finally{meter.checkpoint();}
    throw new PythonRuntimeError("TypeError",`'${diagnosticTypeName(name,meter,100)}' object can't be awaited`);
  }
  let iterator:Value;
  try {iterator=method();}finally{meter.checkpoint();}
  let returnedKind:ReturnType<AwaitableContext<Value>["nativeKind"]>;
  try {returnedKind=context.nativeKind(iterator);}finally{meter.checkpoint();}
  if(returnedKind!==undefined)throw new PythonRuntimeError("TypeError","__await__() returned a coroutine");
  let valid:boolean;
  try {valid=context.hasNext(iterator);}finally{meter.checkpoint();}
  if(!valid) {
    let name:string;try{name=context.typeName(iterator);}finally{meter.checkpoint();}
    throw new PythonRuntimeError("TypeError",`__await__() returned non-iterator of type '${diagnosticTypeName(name,meter,100)}'`);
  }
  return iterator;
}

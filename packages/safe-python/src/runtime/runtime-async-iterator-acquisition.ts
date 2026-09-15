import {PythonRuntimeError} from "./error.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {BuiltinInvocationContext,RuntimeValue} from "./runtime-values.js";

export type RuntimeAsyncIteratorProtocol=Pick<BuiltinInvocationContext,"lookupSpecial"|"hasSpecial"|"call"|"typeName">;

/** Type-level acquisition shared by async for and aiter. The result is checked
 * for an anext slot without binding it, advancing it or treating it as awaitable.
 * Host properties and synchronous iteration are never fallback protocols. */
export function acquireRuntimeAsyncIterator(source:RuntimeValue,protocol:RuntimeAsyncIteratorProtocol,meter:ExecutionMeter,operation:"aiter"|"async for"):RuntimeValue {
  meter.checkpoint();
  if(!protocol.lookupSpecial||!protocol.hasSpecial||!protocol.typeName)throw Error("async iterator acquisition requires type-level protocol capabilities");
  let method:RuntimeValue|undefined;
  try {method=protocol.lookupSpecial(source,"__aiter__");}finally{meter.checkpoint();}
  if(method===undefined) {
    let name:string;
    try {name=protocol.typeName(source);}finally{meter.checkpoint();}
    name=diagnosticTypeName(name,meter,operation==="aiter"?200:100);
    throw new PythonRuntimeError("TypeError",operation==="aiter"?`'${name}' object is not an async iterable`:`'async for' requires an object with __aiter__ method, got ${name}`);
  }
  let iterator:RuntimeValue,valid:boolean;
  try {iterator=protocol.call(method,[]);}finally{meter.checkpoint();}
  try {valid=protocol.hasSpecial(iterator,"__anext__");}finally{meter.checkpoint();}
  if(!valid) {
    let name:string;
    try {name=protocol.typeName(iterator);}finally{meter.checkpoint();}
    name=diagnosticTypeName(name,meter,100);
    throw new PythonRuntimeError("TypeError",operation==="aiter"?`aiter() returned not an async iterator of type '${name}'`:`'async for' received an object from __aiter__ that does not implement __anext__: ${name}`);
  }
  return iterator;
}

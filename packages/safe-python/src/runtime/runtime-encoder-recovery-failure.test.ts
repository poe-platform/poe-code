import {expect,it,vi} from "vitest";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {createRuntimeUtf8Encoder} from "./runtime-utf8-encoding.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

const cases=["ascii","latin-1","utf-8","utf-16","utf-32"].flatMap(encoding=>
  [false,true].flatMap(fallback=>[false,true].map(cancel=>({encoding,fallback,cancel}))));

it.each(cases)("preserves encoder recovery failure: $encoding, fallback=$fallback, cancellation=$cancel",({encoding,fallback,cancel})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const source=values.string("\ud800"),serviceSource=values.string("service");
  const failure=new PythonEncodeError("service",serviceSource.value,0,1,"service encoding failed");
  const repeated=new Error("exception preparation repeated");
  const call=vi.fn(()=>values.none);
  const prepareException=vi.fn(()=>{
    if(cancel)controller.abort();
    if(prepareException.mock.calls.length>1)throw repeated;
    throw failure;
  });
  const context:BuiltinInvocationContext={codecs:registry,isCallable:()=>true,call,prepareException};
  registry.registerError("custom",values.cell({}),context);
  const extension=vi.fn(()=>values.bytes(Uint8Array.of(63)));
  const encode=createRuntimeUtf8Encoder(values,fallback?extension:undefined);
  let caught:unknown;
  try{encode(source,encoding,"custom",meter,context);}catch(error){caught=error;}
  if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else expect(caught).toBe(failure);
  expect(prepareException).toHaveBeenCalledTimes(1);
  expect(call).not.toHaveBeenCalled();
  expect(extension).not.toHaveBeenCalled();
});

it.each(cases)("preserves encoder callback failure: $encoding, fallback=$fallback, cancellation=$cancel",({encoding,fallback,cancel})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:4000000,signal:controller.signal});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter);
  const source=values.string("\ud800"),serviceSource=values.string("service");
  const failure=new PythonEncodeError("service",serviceSource.value,0,1,"callback encoding failed");
  const prepareException=vi.fn((...args:Parameters<NonNullable<BuiltinInvocationContext["prepareException"]>>)=>exceptions.prepare(...args));
  const call=vi.fn(()=>{if(cancel)controller.abort();throw failure;});
  const context:BuiltinInvocationContext={codecs:registry,isCallable:()=>true,call,prepareException};
  registry.registerError("custom",values.cell({}),context);
  const extension=vi.fn(()=>values.bytes(Uint8Array.of(63)));
  const encode=createRuntimeUtf8Encoder(values,fallback?extension:undefined);
  let caught:unknown;
  try{encode(source,encoding,"custom",meter,context);}catch(error){caught=error;}
  if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else expect(caught).toBe(failure);
  expect(prepareException).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledTimes(1);
  expect(extension).not.toHaveBeenCalled();
});

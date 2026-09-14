import {expect,it,vi} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeUtf8Decoder} from "./runtime-utf8-decoding.js";
import {RuntimeValues,type BuiltinInvocationContext} from "./runtime-values.js";

const cases=["utf-8","utf-16","utf-32"].flatMap(encoding=>
  [false,true].flatMap(fallback=>[false,true].map(cancel=>({encoding,fallback,cancel}))));

it.each(cases)("preserves recovery service failure: $encoding, fallback=$fallback, cancellation=$cancel",({encoding,fallback,cancel})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const failure=new PythonDecodeError("service-input",Uint8Array.of(255),0,1,"service decoding failed");
  const call=vi.fn(()=>values.none);
  const prepareException=vi.fn(()=>{if(cancel)controller.abort();throw failure;});
  const context:BuiltinInvocationContext={codecs:registry,isCallable:()=>true,call,prepareException};
  registry.registerError("custom",values.cell({}),context);
  const extension=vi.fn(()=>values.string("unexpected retry"));
  const decode=createRuntimeUtf8Decoder(values,fallback?extension:undefined);
  const bytes=values.bytes(Uint8Array.of(255)).value;
  let caught:unknown;
  try{decode(bytes,encoding,"custom",meter,context);}catch(error){caught=error;}
  if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else expect(caught).toBe(failure);
  expect(prepareException).toHaveBeenCalledTimes(1);
  expect(call).not.toHaveBeenCalled();
  expect(extension).not.toHaveBeenCalled();
});

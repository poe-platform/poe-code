import {expect,it,vi} from "vitest";
import {createRuntimeStringEncodeMethod} from "./runtime-string-encode-method.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {OrderedKeyMap} from "./ordered-key-map.js";

function fixture(){const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter),keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter)),codec=vi.fn(()=>v.bytes(new Uint8Array([1]))),method=createRuntimeStringEncodeMethod(v.string("text"),v,meter,codec);return {meter,v,keywords,codec,method};}
it("binds defaults and codec names without losing source storage",()=>{
  const {meter,v,keywords,codec,method}=fixture();method.value.invoke([],keywords,meter);
  expect(codec.mock.calls[0]?.slice(1,3)).toEqual(["utf-8",undefined]);
  keywords.items.set(v.string("errors"),v.string("ignore"));method.value.invoke([v.string("UTF8")],keywords,meter);
  expect(codec.mock.calls[1]?.slice(1,3)).toEqual(["UTF8","ignore"]);
});
it("rejects bad names before invoking the codec",()=>{
  const {meter,v,keywords,codec,method}=fixture();
  expect(()=>method.value.invoke([v.none],keywords,meter)).toThrow("encode() argument 'encoding' must be str, not None");
  expect(()=>method.value.invoke([v.string("utf\0x")],keywords,meter)).toThrow("embedded null character");
  expect(()=>method.value.invoke([v.string("\ud800")],keywords,meter)).toThrow("surrogates not allowed");
  expect(codec).not.toHaveBeenCalled();
});
it.each([false,true])("preserves cancellation from codec calls (throws=%s)",throws=>{
  const {v,keywords}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const method=createRuntimeStringEncodeMethod(v.string("x"),v,meter,()=>{controller.abort();if(throws)throw Error("codec failed");return v.none;});
  expect(()=>method.value.invoke([],keywords,meter)).toThrow(ExecutionLimitError);
});

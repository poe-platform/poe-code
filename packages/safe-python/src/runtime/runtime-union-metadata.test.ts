import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";
import {RuntimeTypeLayout} from "./runtime-type-layout.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {installRuntimeUnionMetadata} from "./runtime-union-metadata.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const keys={hash:()=>17n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b||(a.kind==="str"&&b.kind==="str"&&a.value.compare(b.value,meter)===0)};
  const namespace=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  const owner=v.type(new RuntimeTypeLayout("Union",[],namespace,meter),"self"),parameter=v.list([]);
  installRuntimeUnionMetadata(owner,v,meter);
  const union=v.instance(owner,undefined,{kind:"union",args:v.tuple([parameter]),hashable:v.frozenSet(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter)),unhashable:undefined});
  const descriptor=namespace.items.lookup(v.string("__parameters__"))!.value;
  if(descriptor.kind!=="getset_descriptor")throw Error("missing parameter descriptor");
  const invocation:BuiltinInvocationContext={call:()=>v.none,isStopIteration:()=>false,attribute:()=>v.none};
  return {meter,v,owner,parameter,union,descriptor,invocation};
}
it("caches the first successful parameter tuple without rereading guest metadata",()=>{
  const s=fixture();let reads=0;s.invocation.attribute=()=>{reads++;return s.v.none;};
  const first=s.descriptor.value.get(s.union,s.meter,s.invocation);
  expect(first.kind==="tuple"&&first.items[0]).toBe(s.parameter);
  s.invocation.attribute=()=>{throw Error("cached metadata reread");};
  expect(s.descriptor.value.get(s.union,s.meter,s.invocation)).toBe(first);expect(reads).toBe(1);
});
it("retries failed discovery and never publishes a partial cache",()=>{
  const s=fixture(),failure=new PythonRuntimeError("ValueError","lookup");s.invocation.attribute=()=>{throw failure;};
  expect(()=>s.descriptor.value.get(s.union,s.meter,s.invocation)).toThrow(failure);
  s.invocation.attribute=()=>s.v.none;
  const result=s.descriptor.value.get(s.union,s.meter,s.invocation);
  expect(result.kind==="tuple"&&result.items[0]).toBe(s.parameter);
});
it("does not cache a result after guest cancellation",()=>{
  const s=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:100000,signal:controller.signal});
  s.invocation.attribute=()=>{controller.abort();return s.v.none;};
  expect(()=>s.descriptor.value.get(s.union,meter,s.invocation)).toThrow(ExecutionLimitError);
  let reads=0;s.invocation.attribute=()=>{reads++;return s.v.none;};
  s.descriptor.value.get(s.union,s.meter,s.invocation);expect(reads).toBe(1);
});

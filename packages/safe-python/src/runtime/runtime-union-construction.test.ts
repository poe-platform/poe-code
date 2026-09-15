import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {RuntimeTypeLayout} from "./runtime-type-layout.js";
import {OrderedKeyMap,type KeyOperations} from "./ordered-key-map.js";
import {constructRuntimeUnion} from "./runtime-union-construction.js";
import {runtimeUnionPayload} from "./runtime-union-state.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const keys:KeyOperations<RuntimeValue>={hash:()=>17n,equal:(a,b)=>a===b};
  const namespace=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  const type=(name:string)=>v.type(new RuntimeTypeLayout(name,[],namespace,meter),"self");
  const a=type("A"),b=type("B"),none=type("NoneType"),union=type("Union");
  return {meter,v,keys,a,b,none,union};
}
it("suppresses only initial hash faults and retains unhashable members",()=>{
  const s=fixture();s.keys.hash=value=>{if(value===s.a)throw new PythonRuntimeError("ValueError","hash");return 17n;};
  const result=constructRuntimeUnion(s.a,s.b,s.v,s.meter,s.keys,()=>s.none,()=>s.union),state=runtimeUnionPayload(result)!;
  expect(state.args.items).toEqual([s.a,s.b]);expect(state.unhashable?.items).toEqual([s.a]);expect(state.hashable.items.size).toBe(1);
});
it.each([2,3])("propagates a hash failure at probe %s after initial classification",stage=>{
  const s=fixture(),failure=new PythonRuntimeError("ValueError","later hash");let calls=0,published=false;
  s.keys.hash=()=>{if(++calls===stage)throw failure;return 17n;};
  expect(()=>constructRuntimeUnion(s.a,s.b,s.v,s.meter,s.keys,()=>s.none,()=>{published=true;return s.union;})).toThrow(failure);
  expect(published).toBe(false);
});
it("does not suppress host hash failures",()=>{
  const s=fixture(),failure=Error("host policy");s.keys.hash=()=>{throw failure;};
  expect(()=>constructRuntimeUnion(s.a,s.b,s.v,s.meter,s.keys,()=>s.none,()=>s.union)).toThrow(failure);
});
it.each(["hash","equal","none","publish"] as const)("preserves cancellation over failing %s callbacks",operation=>{
  const s=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const fail=():never=>{controller.abort();throw new PythonRuntimeError("ValueError","callback");};
  if(operation==="hash"||operation==="equal")s.keys[operation]=fail;
  expect(()=>constructRuntimeUnion(operation==="none"?s.v.none:s.a,s.b,s.v,meter,s.keys,operation==="none"?fail:()=>s.none,operation==="publish"?fail:()=>s.union)).toThrow(ExecutionLimitError);
});
it("collapses a duplicate while preserving the native hash probe sequence",()=>{
  const s=fixture();let hashes=0;s.keys.hash=()=>{hashes++;return 17n;};
  expect(constructRuntimeUnion(s.a,s.a,s.v,s.meter,s.keys,()=>s.none,()=>s.union)).toBe(s.a);expect(hashes).toBe(5);
});

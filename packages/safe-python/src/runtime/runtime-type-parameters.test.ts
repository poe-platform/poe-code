import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {collectRuntimeTypeParameters} from "./runtime-type-parameters.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000}),v=new RuntimeValues(meter);
  const a=v.list([]),b=v.list([]),alias=v.list([]),events:[RuntimeValue,string][]=[];
  const attributes=new Map<RuntimeValue,Map<string,RuntimeValue>>();
  const invocation={attribute(value:RuntimeValue,name:string){events.push([value,name]);const result=attributes.get(value)?.get(name);if(result===undefined)throw new PythonRuntimeError("AttributeError",name);return result;}};
  return {meter,v,a,b,alias,events,attributes,invocation};
}
it("collects substitution markers by presence and deduplicates by identity",()=>{
  const s=fixture();s.attributes.set(s.a,new Map([["__typing_subst__",s.v.none]]));s.attributes.set(s.b,new Map([["__typing_subst__",s.v.false]]));
  expect(collectRuntimeTypeParameters(s.v.tuple([s.a,s.b,s.a]),s.v,s.meter,s.invocation).items).toEqual([s.a,s.b]);
  expect(s.events.map(([,name])=>name)).toEqual(["__typing_subst__","__typing_subst__","__typing_subst__"]);
});
it("merges tuple parameters without recursively interpreting their entries",()=>{
  const s=fixture();s.attributes.set(s.alias,new Map([["__parameters__",s.v.tuple([s.a,s.b,s.a])]]));
  expect(collectRuntimeTypeParameters(s.v.tuple([s.alias]),s.v,s.meter,s.invocation).items).toEqual([s.a,s.b]);
  expect(s.events).toEqual([[s.alias,"__typing_subst__"],[s.alias,"__parameters__"]]);
});
it("recurses through absent list metadata but not explicit non-tuple parameters",()=>{
  const s=fixture();s.attributes.set(s.a,new Map([["__typing_subst__",s.v.none]]));
  const hidden=s.v.list([s.a]);s.attributes.set(hidden,new Map([["__parameters__",s.v.none]]));
  expect(collectRuntimeTypeParameters(s.v.tuple([hidden,s.v.list([s.a])]),s.v,s.meter,s.invocation).items).toEqual([s.a]);
});
it("snapshots list contents before parameter callbacks mutate them",()=>{
  const s=fixture(),args=s.v.list([s.a,s.b]);
  s.invocation.attribute=(value,name)=>{args.items.clear();if(name==="__typing_subst__")return s.v.none;throw Error("unexpected lookup");};
  expect(collectRuntimeTypeParameters(args,s.v,s.meter,s.invocation).items).toEqual([s.a,s.b]);
});
it("propagates non-attribute failures without continuing discovery",()=>{
  const s=fixture(),failure=new PythonRuntimeError("ValueError","lookup");s.invocation.attribute=()=>{throw failure;};
  expect(()=>collectRuntimeTypeParameters(s.v.tuple([s.a]),s.v,s.meter,s.invocation)).toThrow(failure);
});
it("preserves cancellation over missing-attribute and host callback errors",()=>{
  for(const failure of [new PythonRuntimeError("AttributeError","missing"),Error("host")]){
    const s=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
    s.invocation.attribute=()=>{controller.abort();throw failure;};
    expect(()=>collectRuntimeTypeParameters(s.v.tuple([s.a]),s.v,meter,s.invocation)).toThrow(ExecutionLimitError);
  }
});
it("handles deep containers without consuming the host stack and bounds cycles",()=>{
  const s=fixture();s.attributes.set(s.a,new Map([["__typing_subst__",s.v.none]]));let args:RuntimeValue=s.v.tuple([s.a]);
  for(let index=0;index<10000;index++)args=s.v.tuple([args]);
  expect(collectRuntimeTypeParameters(args,s.v,s.meter,s.invocation).items).toEqual([s.a]);
  const cycle=s.v.list([]);cycle.items.append(cycle);
  expect(()=>collectRuntimeTypeParameters(cycle,s.v,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:10000}),s.invocation)).toThrow(ExecutionLimitError);
});

import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeTypeLayout} from "./runtime-type-layout.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {callRuntimeMethodDescriptor} from "./runtime-method-descriptor.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const keys={hash:()=>1n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,v,meter).value};
  const registry=new RuntimeTypeRegistry(v,keys,meter),owner=registry.cellType();
  const descriptor=owner.value.namespace.items.lookup(v.string("__repr__"))!.value;
  if(descriptor.kind!=="wrapper_descriptor")throw Error("expected wrapper");
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  return {meter,v,registry,descriptor,keywords};
}
it("uses the same opaque identities as id and needs no type policy for empty cells",()=>{
  const {meter,v,descriptor,keywords}=fixture(),cell=v.cell({});
  const expected=`<cell at 0x${v.identity.id(cell).toString(16)}: empty>`;
  expect(callRuntimeMethodDescriptor(descriptor,[cell],keywords,meter)).toEqual(v.string(expected));
});
it("validates receiver, arity and keywords before identity access",()=>{
  const {meter,v,descriptor,keywords}=fixture(),cell=v.cell({});
  expect(()=>callRuntimeMethodDescriptor(descriptor,[v.none],keywords,meter)).toThrow("requires a 'cell' object");
  expect(()=>callRuntimeMethodDescriptor(descriptor,[cell,v.none],keywords,meter)).toThrow("expected 0 arguments, got 1");
  keywords.items.set(v.string("x"),v.none);
  expect(()=>callRuntimeMethodDescriptor(descriptor,[cell,v.none],keywords,meter)).toThrow("wrapper __repr__() takes no keyword arguments");
});
it.each([["x",80],["é",40],["😀",20]] as const)("limits %s type metadata to eighty UTF-8 bytes",(character,count)=>{
  const {meter,v,registry,descriptor,keywords}=fixture();
  const type=registry.publish(new RuntimeTypeLayout(character.repeat(count+1),[registry.object.value],v.dictionary(keywords.items.emptyCopy()),meter),registry.type);
  const content=v.instance(type),cell=v.cell({content:{value:content}});
  const result=descriptor.value.invoke(cell,[],keywords,meter,{call:()=>{throw Error("must not invoke guest code");},actualType:()=>type});
  expect(result).toEqual(v.string(`<cell at 0x${v.identity.id(cell).toString(16)}: ${character.repeat(count)} object at 0x${v.identity.id(content).toString(16)}>`));
});
it("preserves fatal cancellation when the type policy throws",()=>{
  const {v,descriptor,keywords}=fixture(),controller=new AbortController(),cell=v.cell({content:{value:v.none}});
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>descriptor.value.invoke(cell,[],keywords,meter,{call:()=>{throw Error("unused");},actualType:()=>{controller.abort();throw Error("type failed");}})).toThrow(ExecutionLimitError);
});
it("checks cancellation when storage access throws",()=>{
  const {v,descriptor,keywords}=fixture(),controller=new AbortController();
  const cell=v.cell({get content(){controller.abort();throw Error("storage failed");}});
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>callRuntimeMethodDescriptor(descriptor,[cell],keywords,meter)).toThrow(ExecutionLimitError);
});
it("rejects output allocation when the representation budget is exhausted",()=>{
  const {v,descriptor,keywords}=fixture(),cell=v.cell({});v.identity.id(cell);
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0});
  expect(()=>descriptor.value.invoke(cell,[],keywords,meter)).toThrow(ExecutionLimitError);
});

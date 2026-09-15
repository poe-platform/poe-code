import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {LexicalFrame} from "./lexical-frame.js";
import {Traceback} from "./traceback.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeExceptionState} from "./runtime-exception-state.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {readRuntimeGetsetDescriptor,mutateRuntimeGetsetDescriptor} from "./runtime-getset-descriptor.js";
import {OrderedKeyMap} from "./ordered-key-map.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const keys={hash:()=>1n,equal:(a:RuntimeValue,b:RuntimeValue)=>a.kind==="str"&&b.kind==="str"&&a.value.compare(b.value,meter)===0},registry=new RuntimeTypeRegistry(v,keys,meter);
  const frame=new LexicalFrame<RuntimeValue>(analyzeModule("def f():pass").scopes.children[0],{globals:new Map(),builtins:new Map()},meter);
  const traceback=registry.traceback(new Traceback(null,frame,0,1,meter),()=>null),type=registry.baseExceptionType(),state=new RuntimeExceptionState(v.tuple([]),meter),exception=v.instance(type,undefined,state);
  const descriptor=type.value.namespace.items.lookup(v.string("__traceback__"))!.value,method=type.value.namespace.items.lookup(v.string("with_traceback"))!.value;
  if(descriptor.kind!=="getset_descriptor"||method.kind!=="method_descriptor")throw Error("expected exception traceback descriptors");
  return {meter,v,registry,traceback,type,state,exception,descriptor,method,empty:v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter))};
}

it("keeps traceback storage independent of cause, context, suppression and arguments",()=>{
  const s=fixture();
  s.state.assignCause(s.exception,s.meter);s.state.assignContext(s.exception,s.meter);
  const args=s.state.args;
  expect(s.method.value.invoke(s.exception,[s.traceback],s.empty,s.meter)).toBe(s.exception);
  expect(s.state.traceback).toBe(s.traceback);expect(s.state.args).toBe(args);
  expect(s.state.cause).toBe(s.exception);expect(s.state.context).toBe(s.exception);expect(s.state.suppressContext).toBe(true);
  mutateRuntimeGetsetDescriptor(s.descriptor,s.exception,{kind:"set",value:s.v.none},s.meter);
  expect(s.state.traceback).toBeNull();expect(s.state.suppressContext).toBe(true);
});

it.each(["set","method","delete"])("preserves the old traceback after invalid %s operations",operation=>{
  const s=fixture();s.state.assignTraceback(s.traceback,s.meter);
  const call=()=>operation==="method"?s.method.value.invoke(s.exception,[s.exception],s.empty,s.meter):mutateRuntimeGetsetDescriptor(s.descriptor,s.exception,operation==="delete"?{kind:"delete"}:{kind:"set",value:s.exception},s.meter);
  expect(call).toThrow(operation==="delete"?"__traceback__ may not be deleted":"__traceback__ must be a traceback or None");
  expect(s.state.traceback).toBe(s.traceback);
});

it.each(["set","method","storage"])("does not publish %s traceback changes after exhaustion",operation=>{
  const s=fixture();s.state.assignTraceback(s.traceback,s.meter);
  const limited=new ExecutionBudget({maxSteps:0,maxAllocatedBytes:10000});
  expect(()=>operation==="storage"?s.state.assignTraceback(null,limited):operation==="method"?s.method.value.invoke(s.exception,[s.v.none],s.empty,limited):mutateRuntimeGetsetDescriptor(s.descriptor,s.exception,{kind:"set",value:s.v.none},limited)).toThrow(ExecutionLimitError);
  expect(s.state.traceback).toBe(s.traceback);
});

it("validates traceback descriptor receivers and preserves unbound access",()=>{
  const s=fixture();
  expect(readRuntimeGetsetDescriptor(s.descriptor,null,s.type,s.meter)).toBe(s.descriptor);
  expect(()=>readRuntimeGetsetDescriptor(s.descriptor,s.traceback,s.type,s.meter)).toThrow("doesn't apply to a 'traceback' object");
  expect(()=>mutateRuntimeGetsetDescriptor(s.descriptor,s.traceback,{kind:"set",value:s.v.none},s.meter)).toThrow("doesn't apply to a 'traceback' object");
});

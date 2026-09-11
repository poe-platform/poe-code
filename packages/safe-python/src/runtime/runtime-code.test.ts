import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileProgram} from "./program-compilation.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {createFunctionState} from "./function-state.js";
import {runtimeNativeAttribute} from "./runtime-native-attribute.js";
import {readRuntimeGetsetDescriptor,mutateRuntimeGetsetDescriptor} from "./runtime-getset-descriptor.js";
import {LexicalFrame} from "./lexical-frame.js";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),v=new RuntimeValues(meter);
  const keys={hash:()=>1n,equal:(a:RuntimeValue,b:RuntimeValue)=>a.kind==="str"&&b.kind==="str"&&a.value.compare(b.value,meter)===0},registry=new RuntimeTypeRegistry(v,keys,meter);
  const program=compileProgram(analyzeModule("def f(a):\n x=2\n return a+x"),{stripDocstring:false},v,meter),code=program.functions.values().next().value!;
  const namespaces={globals:new Map<string,RuntimeValue>(),builtins:new Map<string,RuntimeValue>()};
  const fn=v.function(createFunctionState(code,new Map(),{...namespaces,none:v.none},meter));
  return {controller,meter,v,registry,code,fn,namespaces};
}

it.each(["co_name","co_qualname","co_firstlineno","co_argcount","co_posonlyargcount","co_kwonlyargcount","co_nlocals","co_varnames","co_cellvars","co_freevars"])("publishes owned immutable %s metadata",name=>{
  const s=fixture(),native=s.registry.code(s.code),descriptor=native.type.value.namespace.items.lookup(s.v.string(name))!.value;
  if(descriptor.kind!=="member_descriptor"&&descriptor.kind!=="getset_descriptor")throw Error("expected code descriptor");
  expect(s.registry.code(s.code)).toBe(native);
  expect(readRuntimeGetsetDescriptor(descriptor,native,native.type,s.meter)).toBe(readRuntimeGetsetDescriptor(descriptor,native,native.type,s.meter));
  expect(()=>mutateRuntimeGetsetDescriptor(descriptor,native,{kind:"set",value:s.v.none},s.meter)).toThrow(descriptor.kind==="member_descriptor"?"readonly attribute":`attribute '${name}' of 'code' objects is not writable`);
  expect(()=>mutateRuntimeGetsetDescriptor(descriptor,native,{kind:"delete"},s.meter)).toThrow();
  expect(()=>readRuntimeGetsetDescriptor(descriptor,s.v.instance(s.registry.object),native.type,s.meter)).toThrow("doesn't apply to a 'object' object");
});

it("requires explicit publication instead of reading a shadowed function code attribute",()=>{
  const s=fixture();s.fn.value.attributes.set("__code__",s.v.true);
  expect(()=>runtimeNativeAttribute(s.fn,"__code__",s.v,s.meter)).toThrow("function code reflection requires a code publication policy");
  expect(runtimeNativeAttribute(s.fn,"__code__",s.v,s.meter,undefined,undefined,{code:s.registry.code.bind(s.registry)})).toBe(s.registry.code(s.code));
});

it.each([false,true])("checks cancellation after function code publication (throws=%s)",throws=>{
  const s=fixture(),native=s.registry.code(s.code);
  expect(()=>runtimeNativeAttribute(s.fn,"__code__",s.v,s.meter,undefined,undefined,{code(){s.controller.abort();if(throws)throw Error("publication failure");return native;}})).toThrow(ExecutionLimitError);
});

it("does not fabricate code for manually supplied uncompiled frames",()=>{
  const s=fixture(),frame=s.registry.frame(new LexicalFrame(s.code.scope,s.namespaces,s.meter)),descriptor=frame.type.value.namespace.items.lookup(s.v.string("f_code"))!.value;
  if(descriptor.kind!=="getset_descriptor")throw Error("expected frame code descriptor");
  expect(()=>readRuntimeGetsetDescriptor(descriptor,frame,frame.type,s.meter)).toThrow("frame code reflection requires compiled function metadata");
});

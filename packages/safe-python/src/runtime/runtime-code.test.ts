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

it("publishes module code headers without function fast locals",()=>{
  const s=fixture(),program=compileProgram(analyzeModule("\n\nx=1\n"),{stripDocstring:false,filename:"module.py"},s.v,s.meter),native=s.registry.code(program.module);
  if(native.native?.kind!=="code")throw Error("expected code storage");
  const fields=native.native.fields;
  expect(fields.get("co_name")).toEqual(s.v.string("<module>"));
  expect(fields.get("co_qualname")).toEqual(s.v.string("<module>"));
  expect(fields.get("co_filename")).toEqual(s.v.string("module.py"));
  for(const name of ["co_argcount","co_posonlyargcount","co_kwonlyargcount","co_nlocals","co_flags"])expect(fields.get(name)).toEqual(s.v.integer(0));
  expect(fields.get("co_firstlineno")).toEqual(s.v.integer(1));
  for(const name of ["co_varnames","co_cellvars","co_freevars"])expect(fields.get(name)).toEqual(s.v.tuple([]));
  expect(s.registry.code(program.module)).toBe(native);
});

it.each([false,true])("publishes class closure metadata with one identity for its compiler wrapper (wrapper first=%s)",wrapperFirst=>{
  const s=fixture(),program=compileProgram(analyzeModule("def outer(z,a):\n class C:\n  x=z+a\n  def method(self):return __class__,z,a\n return C"),{stripDocstring:false},s.v,s.meter),body=program.classes.values().next().value!,wrapper=program.classFunctions.values().next().value!;
  const native=s.registry.code(wrapperFirst?wrapper:body);
  expect(s.registry.code(body)).toBe(native);
  expect(s.registry.code(wrapper)).toBe(native);
  if(native.native?.kind!=="code")throw Error("expected code storage");
  const fields=native.native.fields;
  expect(fields.get("co_name")).toEqual(s.v.string("C"));
  expect(fields.get("co_qualname")).toEqual(s.v.string("outer.<locals>.C"));
  expect(fields.get("co_firstlineno")).toEqual(s.v.integer(2));
  expect(fields.get("co_varnames")).toEqual(s.v.tuple([]));
  expect(fields.get("co_cellvars")).toEqual(s.v.tuple([s.v.string("__class__")]));
  expect(fields.get("co_freevars")).toEqual(s.v.tuple([s.v.string("a"),s.v.string("z")]));
  expect(fields.get("co_nlocals")).toEqual(s.v.integer(0));
});

it.each(["co_name","co_qualname","co_filename","co_flags","co_firstlineno","co_argcount","co_posonlyargcount","co_kwonlyargcount","co_nlocals","co_varnames","co_cellvars","co_freevars"])("publishes owned immutable %s metadata",name=>{
  const s=fixture(),native=s.registry.code(s.code),descriptor=native.type.value.namespace.items.lookup(s.v.string(name))!.value;
  if(descriptor.kind!=="member_descriptor"&&descriptor.kind!=="getset_descriptor")throw Error("expected code descriptor");
  expect(s.registry.code(s.code)).toBe(native);
  expect(readRuntimeGetsetDescriptor(descriptor,native,native.type,s.meter)).toBe(readRuntimeGetsetDescriptor(descriptor,native,native.type,s.meter));
  expect(()=>mutateRuntimeGetsetDescriptor(descriptor,native,{kind:"set",value:s.v.none},s.meter)).toThrow(descriptor.kind==="member_descriptor"?"readonly attribute":`attribute '${name}' of 'code' objects is not writable`);
  expect(()=>mutateRuntimeGetsetDescriptor(descriptor,native,{kind:"delete"},s.meter)).toThrow();
  expect(()=>readRuntimeGetsetDescriptor(descriptor,s.v.instance(s.registry.object),native.type,s.meter)).toThrow("doesn't apply to a 'object' object");
});

it("does not invent flags for legacy manually assembled code",()=>{
  const s=fixture(),native=s.registry.code({...s.code,flags:undefined}),descriptor=native.type.value.namespace.items.lookup(s.v.string("co_flags"))!.value;
  if(descriptor.kind!=="member_descriptor")throw Error("expected flags member");
  expect(()=>readRuntimeGetsetDescriptor(descriptor,native,native.type,s.meter)).toThrow("missing compiler code metadata");
});

it("does not invent filenames for legacy manually assembled code",()=>{
  const s=fixture(),code={...s.code,source:undefined},native=s.registry.code(code),descriptor=native.type.value.namespace.items.lookup(s.v.string("co_filename"))!.value;
  if(descriptor.kind!=="member_descriptor")throw Error("expected filename member");
  expect(()=>readRuntimeGetsetDescriptor(descriptor,native,native.type,s.meter)).toThrow("missing compiler code metadata");
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

import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {LexicalFrame} from "./lexical-frame.js";
import {Traceback} from "./traceback.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createTracebackNewBuiltin} from "./builtin-traceback-new.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";
import {readRuntimeGetsetDescriptor,mutateRuntimeGetsetDescriptor} from "./runtime-getset-descriptor.js";

function fixture(resolve:(frame:LexicalFrame<RuntimeValue>,instruction:number)=>number|null=()=>null,constructorResolver?:typeof resolve){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),v=new RuntimeValues(meter);
  const keys={hash:()=>1n,equal:(a:RuntimeValue,b:RuntimeValue)=>a.kind==="str"&&b.kind==="str"&&a.value.compare(b.value,meter)===0},registry=new RuntimeTypeRegistry(v,keys,meter,constructorResolver);
  const frame=new LexicalFrame<RuntimeValue>(analyzeModule("def f():pass").scopes.children[0],{globals:new Map(),builtins:new Map()},meter),tb=new Traceback(null,frame,4,-1,meter),native=registry.traceback(tb,resolve);
  function descriptor(name:string){const result=native.type.value.namespace.items.lookup(v.string(name))!.value;if(result.kind!=="getset_descriptor"&&result.kind!=="member_descriptor")throw Error("expected traceback descriptor");return result;}
  return {controller,meter,v,registry,frame,tb,native,descriptor,keys};
}

it.each([false,true])("uses only explicit code metadata for guest-constructed lazy lines (available=%s)",available=>{
  const s=fixture(undefined,available?()=>77:undefined),create=s.native.type.value.namespace.items.lookup(s.v.string("__new__"))!.value;
  if(create.kind!=="builtin_function_or_method")throw Error("expected native constructor");
  const empty=s.v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(s.keys,s.meter));
  const result=create.value.invoke([s.native.type,s.v.none,s.registry.frame(s.frame),s.v.integer(4),s.v.integer(-1)],empty,s.meter);
  const read=()=>readRuntimeGetsetDescriptor(s.descriptor("tb_lineno"),result,s.native.type,s.meter);
  if(available)expect(read()).toEqual(s.v.integer(77));
  else expect(read).toThrow("traceback line resolution requires interpreter code metadata");
});

it.each([false,true])("checks constructor cancellation after index callbacks (throws=%s)",throws=>{
  const s=fixture(),empty=s.v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(s.keys,s.meter));
  let created=false;
  const create=createTracebackNewBuiltin(s.native.type,s.v,s.meter,()=>{created=true;return s.v.none;});
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},isStopIteration:()=>false,integerIndex:{integer:()=>undefined,isExactInteger:()=>false,typeName:()=>"test",warn(){throw Error("unexpected warning");},lookupIndex(){s.controller.abort();if(throws)throw Error("index failure");return undefined;}}};
  expect(()=>create.value.invoke([s.native.type,s.v.none,s.registry.frame(s.frame),s.v.none,s.v.integer(1)],empty,s.meter,context)).toThrow(ExecutionLimitError);
  expect(created).toBe(false);
});

it.each([false,true])("checks constructor cancellation after allocation callbacks (throws=%s)",throws=>{
  const s=fixture(),empty=s.v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(s.keys,s.meter));
  const create=createTracebackNewBuiltin(s.native.type,s.v,s.meter,()=>{s.controller.abort();if(throws)throw Error("allocation failure");return s.v.none;});
  expect(()=>create.value.invoke([s.native.type,s.v.none,s.registry.frame(s.frame),s.v.integer(0),s.v.integer(1)],empty,s.meter)).toThrow(ExecutionLimitError);
});

it.each(["receiver","frame","next"])("checks constructor cancellation during %s diagnostics",position=>{
  for(const throws of [false,true]){
    const s=fixture(),empty=s.v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(s.keys,s.meter));
    let created=false;
    const create=createTracebackNewBuiltin(s.native.type,s.v,s.meter,()=>{created=true;return s.v.none;});
    const args=[s.native.type,s.v.none,s.registry.frame(s.frame),s.v.integer(0),s.v.integer(1)];
    args[position==="receiver"?0:position==="frame"?2:1]=s.v.true;
    const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},isStopIteration:()=>false,typeName(){s.controller.abort();if(throws)throw Error("name failure");return "bad";}};
    expect(()=>create.value.invoke(args,empty,s.meter,context)).toThrow(ExecutionLimitError);
    expect(created).toBe(false);
  }
});

it("requires the explicit constructor receiver even with complete keywords",()=>{
  const s=fixture(),keywords=s.v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(s.keys,s.meter));
  for(const [key,value] of [["tb_next",s.v.none],["tb_frame",s.registry.frame(s.frame)],["tb_lasti",s.v.integer(0)],["tb_lineno",s.v.integer(1)]] as const)keywords.items.set(s.v.string(key),value);
  const create=createTracebackNewBuiltin(s.native.type,s.v,s.meter,()=>{throw Error("must not allocate");});
  expect(()=>create.value.invoke([],keywords,s.meter)).toThrow("traceback.__new__(): not enough arguments");
});

it("returns None for an unmapped saved instruction and retains initial publication identity",()=>{
  const s=fixture(),line=s.descriptor("tb_lineno");
  expect(readRuntimeGetsetDescriptor(line,s.native,s.native.type,s.meter)).toBe(s.v.none);
  expect(s.registry.traceback(s.tb,()=>99)).toBe(s.native);
  expect(readRuntimeGetsetDescriptor(line,s.native,s.native.type,s.meter)).toBe(s.v.none);
});

it.each([false,true])("preserves cancellation through native lazy line access (throws=%s)",throws=>{
  const s=fixture(()=>{s.controller.abort();if(throws)throw Error("line failure");return 12;}),line=s.descriptor("tb_lineno");
  expect(()=>readRuntimeGetsetDescriptor(line,s.native,s.native.type,s.meter)).toThrow(ExecutionLimitError);
});

it.each([false,true])("preserves links when invalid-target diagnostics cancel (throws=%s)",throws=>{
  const s=fixture(),next=s.descriptor("tb_next");
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},isStopIteration:()=>false,typeName(){s.controller.abort();if(throws)throw Error("name failure");return "bad";}};
  expect(()=>mutateRuntimeGetsetDescriptor(next,s.native,{kind:"set",value:s.v.true},s.meter,context)).toThrow(ExecutionLimitError);
  expect(s.tb.next).toBeNull();
});

it.each(["X","é","🐍"])("retains untruncated %s type names in invalid-link diagnostics",character=>{
  const s=fixture(),next=s.descriptor("tb_next"),name=character.repeat(1000);
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},isStopIteration:()=>false,typeName:()=>name};
  expect(()=>mutateRuntimeGetsetDescriptor(next,s.native,{kind:"set",value:s.v.true},s.meter,context)).toThrow(`expected traceback object, got '${name}'`);
  expect(s.tb.next).toBeNull();
});

it.each(["tb_frame","tb_lasti","tb_lineno","tb_next"])("validates %s descriptor ownership before native access",name=>{
  const s=fixture(),descriptor=s.descriptor(name);
  expect(readRuntimeGetsetDescriptor(descriptor,null,s.native.type,s.meter)).toBe(descriptor);
  expect(readRuntimeGetsetDescriptor(descriptor,s.v.none,s.native.type,s.meter)).toBe(descriptor);
  expect(()=>readRuntimeGetsetDescriptor(descriptor,s.v.instance(s.registry.object),s.native.type,s.meter)).toThrow("doesn't apply to a 'object' object");
  expect(()=>mutateRuntimeGetsetDescriptor(descriptor,s.v.none,{kind:"delete"},s.meter)).toThrow("doesn't apply to a 'NoneType' object");
});

it("retains old links when native cycle traversal exhausts its budget",()=>{
  const s=fixture(),tail=new Traceback(null,s.frame,0,1,s.meter);
  let chain=tail;for(let i=0;i<20;i++)chain=new Traceback(chain,s.frame,i,1,s.meter);
  const candidate=s.registry.traceback(chain,()=>1),next=s.descriptor("tb_next"),limited=new ExecutionBudget({maxSteps:5,maxAllocatedBytes:100000});
  expect(()=>mutateRuntimeGetsetDescriptor(next,s.native,{kind:"set",value:candidate},limited)).toThrow(ExecutionLimitError);
  expect(s.tb.next).toBeNull();
});

import {expect,it,vi} from "vitest";
import {analyzeModule} from "../analysis.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {LexicalFrame} from "./lexical-frame.js";
import {ModuleFrame} from "./module-frame.js";
import {RuntimeDictionaryNamespace} from "./runtime-dictionary-namespace.js";
import {FrameLocalsMapping} from "./frame-locals-mapping.js";
import {createFrameLocalsProxyNewBuiltin} from "./builtin-frame-locals-proxy-new.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {runtimeHash} from "./runtime-hash.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeMappingNamespace} from "./runtime-mapping-namespace.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const hash={none:values.none,identity:()=>17n,string:()=>23n,bytes:()=>29n};
  const keys={hash:(key:RuntimeValue)=>runtimeHash(key,hash,meter),equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const registry=new RuntimeTypeRegistry(values,keys,meter),frame=new LexicalFrame<RuntimeValue>(analyzeModule("def f(x):return x").scopes.children[0],{globals:new Map(),builtins:new Map()},meter);
  const proxy=registry.frameLocalsProxy(frame),empty=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},isStopIteration:()=>false,formatting:{isExactString:value=>value.kind==="str",isExactInteger:()=>false,string:value=>value.kind==="str"?value.value:undefined,stringPoints:value=>values.stringPoints(value),lookupFormat:()=>undefined,lookupStr:()=>undefined,lookupRepr:()=>()=>values.string("key"),defaultRepr:()=>values.string("key"),typeName:()=>"object"}};
  function method(name:string){const descriptor=proxy.type.value.namespace.items.lookup(values.string(name))!.value;if(descriptor.kind!=="method_descriptor"&&descriptor.kind!=="wrapper_descriptor")throw Error("expected descriptor");return (args:RuntimeValue[])=>descriptor.value.invoke(proxy,args,empty,meter,context);}
  return {controller,meter,values,frame,proxy,empty,context,method,registry};
}

it("returns fresh optimized locals snapshots including proxy extras",()=>{
  const {registry,frame,values,proxy}=fixture();
  frame.store("x",values.integer(1));
  if(proxy.native?.kind!=="frame_locals_proxy")throw Error("expected locals proxy");
  proxy.native.mapping.set(values.integer(7),values.true);
  const first=registry.frameLocals(frame);
  frame.store("x",values.integer(2));
  const second=registry.frameLocals(frame);
  if(first.kind!=="dict"||second.kind!=="dict")throw Error("expected dictionary snapshots");
  expect(first).not.toBe(second);
  expect(first.items.lookup(values.string("x"))?.value).toEqual(values.integer(1));
  expect(second.items.lookup(values.string("x"))?.value).toEqual(values.integer(2));
  expect(first.items.lookup(values.integer(7))?.value).toBe(values.true);
  first.items.set(values.string("x"),values.false);expect(frame.load("x")).toEqual(values.integer(2));
});
it("retains ordinary module locals identity",()=>{
  const {registry,values,meter,empty}=fixture(),names=new RuntimeDictionaryNamespace(empty,values,meter);
  const frame=new ModuleFrame(analyzeModule("pass").scopes,{globals:names,builtins:new Map()},meter);
  expect(registry.frameLocals(frame)).toBe(empty);
});
it.each([false,true])("checks cancellation after locals identity policy (throws=%s)",throws=>{
  const {registry,values,meter,controller}=fixture();
  const names={lookup:vi.fn(),store:vi.fn(),delete:()=>false,isGuest:()=>false,get object(){controller.abort();if(throws)throw Error("identity failed");return values.none;}};
  const frame=new ModuleFrame(analyzeModule("pass").scopes,{globals:names,builtins:new Map()},meter);
  expect(()=>registry.frameLocals(frame)).toThrow(ExecutionLimitError);
});

it.each(["f_globals","f_builtins"] as const)("requires original guest identity for %s reflection",name=>{
  const {registry,frame,values,meter}=fixture(),native=registry.frame(frame);
  const descriptor=native.type.value.namespace.items.lookup(values.string(name))!.value;
  if(descriptor.kind!=="getset_descriptor")throw Error("expected frame descriptor");
  expect(()=>descriptor.value.get(native,meter)).toThrow("frame namespace reflection requires an original guest object");
});

it("reflects nonmapping selected builtins without invoking their item protocol",()=>{
  const {registry,values,meter,context}=fixture();
  const frame=new LexicalFrame<RuntimeValue>(analyzeModule("def f():pass").scopes.children[0],{globals:new Map(),builtins:new RuntimeMappingNamespace(values.none,values,meter,context)},meter),native=registry.frame(frame);
  const descriptor=native.type.value.namespace.items.lookup(values.string("f_builtins"))!.value;
  if(descriptor.kind!=="getset_descriptor")throw Error("expected frame descriptor");
  expect(descriptor.value.get(native,meter)).toBe(values.none);
});

it.each([false,true])("checks cancellation after namespace identity callbacks (throws=%s)",throws=>{
  const {registry,values,meter,controller}=fixture();
  const builtins={lookup:vi.fn(),get object(){controller.abort();if(throws)throw Error("identity failure");return values.none;}};
  const frame=new LexicalFrame<RuntimeValue>(analyzeModule("def f():pass").scopes.children[0],{globals:new Map(),builtins},meter),native=registry.frame(frame);
  const descriptor=native.type.value.namespace.items.lookup(values.string("f_builtins"))!.value;
  if(descriptor.kind!=="getset_descriptor")throw Error("expected frame descriptor");
  expect(()=>descriptor.value.get(native,meter)).toThrow(ExecutionLimitError);
  expect(builtins.lookup).not.toHaveBeenCalled();
});

it.each(["steps","allocation","cancelled"] as const)("does not classify a host %s termination as a missing local",reason=>{
  const {context,method,values}=fixture(),fatal=new ExecutionLimitError(reason),get=method("get"),key=values.string("missing");
  context.formatting!.lookupRepr=()=>()=>{throw fatal;};context.isException=vi.fn(()=>true);
  expect(()=>get([key,values.none])).toThrow(fatal);expect(context.isException).not.toHaveBeenCalled();
});

it.each(["lookup","repr","string"] as const)("checks cancellation after failing missing-key %s callbacks",boundary=>{
  const {context,method,values,controller}=fixture(),get=method("__getitem__"),key=values.string("missing");
  const fail=()=>{controller.abort();throw Error("callback failure");};
  if(boundary==="lookup")context.formatting!.lookupRepr=fail;
  else if(boundary==="repr")context.formatting!.lookupRepr=()=>fail;
  else context.formatting!.string=fail;
  expect(()=>get([key])).toThrow(ExecutionLimitError);
});

it.each([false,true])("checks cancellation after dictionary comparison (throws=%s)",throws=>{
  const {context,method,empty,controller,values}=fixture(),compare=method("__eq__");
  context.compare=()=>{controller.abort();if(throws)throw Error("comparison failure");return values.true;};
  expect(()=>compare([empty])).toThrow(ExecutionLimitError);
});

it.each([false,true])("checks cancellation after exception classification (throws=%s)",throws=>{
  const {context,method,controller,values}=fixture(),get=method("get"),key=values.string("missing"),guest=Object.freeze({});
  context.formatting!.lookupRepr=()=>()=>{throw guest;};
  context.isException=()=>{controller.abort();if(throws)throw Error("classification failure");return true;};
  expect(()=>get([key])).toThrow(ExecutionLimitError);
});

it("preserves ordinary callback failures and nonboolean rich comparison results",()=>{
  const {context,method,empty,values}=fixture(),compare=method("__eq__"),result=values.list([]),failure=Error("ordinary failure");
  context.compare=()=>result;expect(compare([empty])).toBe(result);
  context.compare=()=>{throw failure;};expect(()=>compare([empty])).toThrow(failure);
});

it("does not publish a default after classification cancels execution",()=>{
  const {context,method,controller,values}=fixture(),setdefault=method("setdefault"),key=values.string("x"),guest=Object.freeze({});
  context.formatting!.lookupRepr=()=>()=>{throw guest;};
  context.isException=()=>{controller.abort();return true;};
  const write=vi.spyOn(FrameLocalsMapping.prototype,"set");
  try{expect(()=>setdefault([key,values.integer(9)])).toThrow(ExecutionLimitError);expect(write).not.toHaveBeenCalled();}
  finally{write.mockRestore();}
});

it.each(["update","__ior__"])("never converts host termination from %s sources",name=>{
  const {context,method,proxy}=fixture(),invoke=method(name),fatal=new ExecutionLimitError("steps");
  context.attribute=()=>{throw fatal;};context.isException=vi.fn(()=>true);context.causeException=vi.fn();
  expect(()=>invoke([proxy])).toThrow(fatal);expect(context.isException).not.toHaveBeenCalled();expect(context.causeException).not.toHaveBeenCalled();
});

it.each([false,true])("checks cancellation after bulk exception wrapping (throws=%s)",throws=>{
  const {context,method,proxy,controller}=fixture(),invoke=method("__ior__"),guest=Object.freeze({});
  context.attribute=()=>{throw guest;};context.isException=()=>true;
  context.causeException=()=>{controller.abort();if(throws)throw Error("wrapping failure");return guest;};
  expect(()=>invoke([proxy])).toThrow(ExecutionLimitError);
});

it.each([false,true])("clears repr guards after callback errors (fatal=%s)",fatal=>{
  const {context,method,values}=fixture(),repr=method("__repr__"),error=fatal?new ExecutionLimitError("steps"):Error("repr failure");
  context.formatting!.lookupRepr=()=>()=>{throw error;};
  expect(()=>repr([])).toThrow(error);
  context.formatting!.lookupRepr=()=>()=>values.string("recovered");
  expect(repr([])).toEqual(values.string("recovered"));
});

it.each([false,true])("observes cancellation after dictionary repr callbacks (throws=%s)",throws=>{
  const {context,method,values,controller}=fixture(),repr=method("__repr__");
  context.formatting!.lookupRepr=()=>()=>{controller.abort();if(throws)throw Error("repr failure");return values.string("result");};
  expect(()=>repr([])).toThrow(ExecutionLimitError);
});

it.each(["receiver","frame"])("checks constructor cancellation during %s diagnostics",position=>{
  for(const throws of [false,true]){
    const {context,controller,proxy,values,meter,empty,registry}=fixture(),create=vi.fn(registry.frameLocalsProxy.bind(registry));
    const builtin=createFrameLocalsProxyNewBuiltin(proxy.type,values,meter,create),args=position==="receiver"?[values.none]:[proxy.type,values.none];
    context.typeName=()=>{controller.abort();if(throws)throw Error("name failure");return "bad";};
    expect(()=>builtin.value.invoke(args,empty,meter,context)).toThrow(ExecutionLimitError);expect(create).not.toHaveBeenCalled();
  }
});

it.each([false,true])("checks constructor cancellation after proxy creation (throws=%s)",throws=>{
  const {context,controller,proxy,frame,values,meter,empty,registry}=fixture(),native=registry.frame(frame);
  const builtin=createFrameLocalsProxyNewBuiltin(proxy.type,values,meter,backing=>{expect(backing).toBe(frame);controller.abort();if(throws)throw Error("creation failure");return proxy;});
  expect(()=>builtin.value.invoke([proxy.type,native],empty,meter,context)).toThrow(ExecutionLimitError);
});

it.each(["receiver","frame"])("names primitive %s arguments without an invocation adapter",position=>{
  const {proxy,values,meter,empty,registry}=fixture(),builtin=createFrameLocalsProxyNewBuiltin(proxy.type,values,meter,registry.frameLocalsProxy.bind(registry));
  const args=position==="receiver"?[values.none]:[proxy.type,values.none];
  expect(()=>builtin.value.invoke(args,empty,meter)).toThrow(position==="receiver"?"FrameLocalsProxy.__new__(X): X is not a type object (NoneType)":"expect frame, not NoneType");
});

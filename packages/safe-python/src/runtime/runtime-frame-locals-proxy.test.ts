import {expect,it,vi} from "vitest";
import {analyzeModule} from "../analysis.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {LexicalFrame} from "./lexical-frame.js";
import {FrameLocalsMapping} from "./frame-locals-mapping.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {runtimeHash} from "./runtime-hash.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const hash={none:values.none,identity:()=>17n,string:()=>23n,bytes:()=>29n};
  const keys={hash:(key:RuntimeValue)=>runtimeHash(key,hash,meter),equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const registry=new RuntimeTypeRegistry(values,keys,meter),frame=new LexicalFrame<RuntimeValue>(analyzeModule("def f(x):return x").scopes.children[0],{globals:new Map(),builtins:new Map()},meter);
  const proxy=registry.frameLocalsProxy(frame),empty=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},isStopIteration:()=>false,formatting:{isExactString:value=>value.kind==="str",isExactInteger:()=>false,string:value=>value.kind==="str"?value.value:undefined,stringPoints:value=>values.stringPoints(value),lookupFormat:()=>undefined,lookupStr:()=>undefined,lookupRepr:()=>()=>values.string("key"),defaultRepr:()=>values.string("key"),typeName:()=>"object"}};
  function method(name:string){const descriptor=proxy.type.value.namespace.items.lookup(values.string(name))!.value;if(descriptor.kind!=="method_descriptor"&&descriptor.kind!=="wrapper_descriptor")throw Error("expected descriptor");return (args:RuntimeValue[])=>descriptor.value.invoke(proxy,args,empty,meter,context);}
  return {controller,meter,values,frame,proxy,empty,context,method};
}

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

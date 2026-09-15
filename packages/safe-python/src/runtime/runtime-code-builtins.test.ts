import {expect,it,vi} from "vitest";
import {CallStack} from "./call-stack.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createRuntimeCodeBuiltins,type RuntimeCodeBuiltinPolicy} from "./runtime-code-builtins.js";
import {RuntimeCodePrograms} from "./runtime-code-programs.js";
import {createRuntimeKeyOperations} from "./runtime-key-operations.js";
import type {RuntimeProgramHooks} from "./runtime-program.js";
import {RuntimeValues,type BuiltinInvocationContext} from "./runtime-values.js";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),v=new RuntimeValues(meter),calls=new CallStack<object>(50,meter);
  const keys=createRuntimeKeyOperations(v,{none:v.none,identity:()=>17n,string:()=>23n,bytes:()=>29n},meter);
  const builtins=v.dictionary(new OrderedKeyMap(keys,meter)),globals=v.dictionary(new OrderedKeyMap(keys,meter)),keywords=v.dictionary(new OrderedKeyMap(keys,meter));
  const unused=():never=>{throw Error("unexpected host hook");};
  const hooks:RuntimeProgramHooks={expressions:()=>({warn:unused}),statements:()=>({setAttribute:unused,deleteAttribute:unused,executeUnhandled:unused}),callable:()=>false,name:()=>"guest()",keywordName:unused,invoke:unused};
  const context={values:v,keys,calls,hooks},programs=new RuntimeCodePrograms(meter,v);
  const policy:RuntimeCodeBuiltinPolicy={currentFrame:vi.fn(()=>undefined),frameLocals:vi.fn(unused),builtins,
    compilation:()=>({stripDocstring:false,enterRecursiveCall:()=>calls.enter({})}),
    code:vi.fn(code=>{expect(programs.lookup(code)?.module).toBe(code);return v.integer(code.flags??0);})};
  const invocation:BuiltinInvocationContext={call:unused,hasSpecial:value=>value.kind==="dict",typeName:value=>value.kind};
  return {controller,meter,v,context,programs,policy,globals,builtins,keywords,invocation};
}

it("compiles without a guest caller and registers code before publication",()=>{
  const {v,context,programs,policy,meter,keywords}=fixture(),builtins=createRuntimeCodeBuiltins(context,programs,policy,meter);
  expect(builtins.compile.value.invoke([v.string("42"),v.string("child.py"),v.string("eval")],keywords,meter)).toEqual(v.integer(0));
  expect(policy.frameLocals).not.toHaveBeenCalled();expect(policy.code).toHaveBeenCalledTimes(1);
});

it("executes explicit globals without a caller and inserts only execution-owned builtins",()=>{
  const {v,context,programs,policy,meter,keywords,globals,builtins,invocation}=fixture(),family=createRuntimeCodeBuiltins(context,programs,policy,meter);
  expect(family.exec.value.invoke([v.string("x=40"),globals],keywords,meter,invocation)).toBe(v.none);
  expect(family.eval.value.invoke([v.string("x+2"),globals],keywords,meter,invocation)).toEqual(v.integer(42));
  expect(globals.items.lookup(v.string("__builtins__"))?.value).toBe(builtins);expect(policy.frameLocals).not.toHaveBeenCalled();
});

it.each(["eval","exec"] as const)("rejects implicit %s globals without a guest frame",name=>{
  const {v,context,programs,policy,meter,keywords,invocation}=fixture(),builtins=createRuntimeCodeBuiltins(context,programs,policy,meter);
  expect(()=>builtins[name].value.invoke([v.string("42")],keywords,meter,invocation)).toThrow(name==="eval"?"eval must be given globals and locals when called without a frame":"globals and locals cannot be NULL");
  expect(policy.frameLocals).not.toHaveBeenCalled();
});

it.each([false,true])("preserves cancellation from current-frame policy (throws=%s)",throws=>{
  const {v,context,programs,policy,meter,keywords,invocation,controller}=fixture();
  policy.currentFrame=()=>{controller.abort();if(throws)throw Error("frame read failed");return undefined;};
  const builtins=createRuntimeCodeBuiltins(context,programs,policy,meter),source=v.string("42");
  expect(()=>builtins.eval.value.invoke([source],keywords,meter,invocation)).toThrow(ExecutionLimitError);
});

it.each([false,true])("preserves cancellation during builtin policy assembly (throws=%s)",throws=>{
  const {context,programs,policy,meter,controller}=fixture(),compilation=policy.compilation;
  Object.defineProperty(policy,"compilation",{get(){controller.abort();if(throws)throw Error("policy read failed");return compilation;}});
  expect(()=>createRuntimeCodeBuiltins(context,programs,policy,meter)).toThrow(ExecutionLimitError);
});

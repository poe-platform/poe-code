import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {LexicalFrame} from "./lexical-frame.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

function fixture(source="def f(z,a):\n x=1\n y=2\n return lambda:z+x"){
  const scope=analyzeModule(source).scopes.children[0],meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
  const namespaces={globals:new Map<string,unknown>(),builtins:new Map<string,unknown>()},frame=new LexicalFrame<unknown>(scope,namespaces,meter);
  return {scope,meter,namespaces,frame};
}
it("snapshots bound fast locals and cells in compiler order",()=>{
  const {frame}=fixture();frame.store("y",4);frame.store("x",3);frame.store("a",2);frame.store("z",1);
  const view=frame.reflectLocals(),snapshot=view.snapshot();
  expect([...snapshot]).toEqual([["z",1],["a",2],["y",4],["x",3]]);
  frame.store("a",9);expect(snapshot.get("a")).toBe(2);expect(view.lookup("a")).toEqual({value:9});
  snapshot.set("z",10);expect(frame.load("z")).toBe(1);expect(view.snapshot()).not.toBe(snapshot);
});
it("preserves bound undefined/null and excludes unbound slots",()=>{
  const {frame}=fixture();frame.store("z",undefined);frame.store("a",null);
  const view=frame.reflectLocals();expect([...view.snapshot()]).toEqual([["z",undefined],["a",null]]);
  frame.delete("z");expect(view.lookup("z")).toBeUndefined();expect(view.snapshot().has("z")).toBe(false);
  expect(view.store("z",undefined)).toBe(true);expect(frame.load("z")).toBeUndefined();
});
it("shares write-through cells with sibling and forwarded closures",()=>{
  const {frame,scope,namespaces,meter}=fixture("def f():\n x=1\n def middle():return lambda:x\n return middle");
  const child=new LexicalFrame(scope.children[0],{...namespaces,closure:frame.capture(scope.children[0])},meter),view=child.reflectLocals();
  expect(view.lookup("x")).toBeUndefined();expect(view.store("x",7)).toBe(true);expect(frame.load("x")).toBe(7);
  expect([...view.snapshot()]).toEqual([["x",7]]);frame.store("x",8);expect(view.lookup("x")).toEqual({value:8});
});
it("keeps reflection names literal and excludes globals and annotation-only declarations",()=>{
  const analysis=analyzeModule("class C:\n def f(__x):\n  unused: int\n  global g\n  return __x+g"),scope=analysis.scopes.children[0].children[0];
  const globals=new Map<string,unknown>([["g",3]]),frame=new LexicalFrame(scope,{globals,builtins:new Map()},new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000})),view=frame.reflectLocals();
  for(const name of ["__x","unused","g","missing"]){expect(view.store(name,9)).toBe(false);expect(view.lookup(name)).toBeUndefined();}
  expect(view.store("_C__x",5)).toBe(true);expect(frame.load("__x")).toBe(5);expect(globals.get("g")).toBe(3);
});
it("rejects deletion of bound and unbound local slots without mutation",()=>{
  const {frame}=fixture(),view=frame.reflectLocals();
  for(const name of ["z","a","x","y"])expect(()=>view.delete(name)).toThrow("cannot remove local variables from FrameLocalsProxy");
  view.store("a",2);expect(()=>view.delete("a")).toThrow("cannot remove local variables from FrameLocalsProxy");expect(frame.load("a")).toBe(2);
  expect(view.delete("unknown")).toBe(false);
});
it("reuses execution-owned storage without sharing it between activations",()=>{
  const a=fixture(),b=fixture();expect(a.frame.reflectLocals()).toBe(a.frame.reflectLocals());expect(a.frame.reflectLocals()).not.toBe(b.frame.reflectLocals());
});
it("checks cancellation before reflective reads and writes",()=>{
  const controller=new AbortController(),scope=analyzeModule("def f(x):return x").scopes.children[0],meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:100000,signal:controller.signal});
  const frame=new LexicalFrame(scope,{globals:new Map(),builtins:new Map()},meter),view=frame.reflectLocals();frame.store("x",1);controller.abort();
  for(const operation of [()=>view.lookup("x"),()=>view.store("x",2),()=>view.delete("x"),()=>view.snapshot(),()=>frame.reflectLocals()])expect(operation).toThrow(ExecutionLimitError);
});
it("preserves cell and unbound-slot contents when allocation limits reject a write",()=>{
  let reject=false;
  const meter={checkpoint(_steps=1,bytes=0){if(reject&&bytes>0)throw new ExecutionLimitError("allocated bytes");}};
  const scope=analyzeModule("def f(x,y):return lambda:x").scopes.children[0],frame=new LexicalFrame(scope,{globals:new Map(),builtins:new Map()},meter);
  frame.store("x",1);const view=frame.reflectLocals();reject=true;
  expect(()=>view.store("x",2)).toThrow(ExecutionLimitError);expect(()=>view.store("y",2)).toThrow(ExecutionLimitError);
  reject=false;expect(view.lookup("x")).toEqual({value:1});expect(view.lookup("y")).toBeUndefined();
});

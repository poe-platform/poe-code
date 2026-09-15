import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileInlineLocalLayout} from "./inline-local-layout.js";

it.each([
  ["[[y for y in x] for x in xs]",["x","y"]],
  ["[(y,[y for y in x]) for x in xs]",["x"]],
  ["[(lambda:y,[y for y in x]) for x in xs]",["x","y"]],
  ["[x for x in xs if (a:=x)]",["x","a"]],
  ["[(y for y in x) for x in xs]",["x"]]
] as const)("compiles isolated inline storage without clearing referenced outer bindings: %s",(source,names)=>{
  const scope=analyzeModule(source).scopes.children[0];
  expect(compileInlineLocalLayout(scope,new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000})).variableNames).toEqual(names);
});
it("caches nested inline layouts without bypassing cancellation",()=>{
  const scope=analyzeModule("[[y for y in x] for x in xs]").scopes.children[0],cache=new WeakMap();
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const layout=compileInlineLocalLayout(scope,meter,cache);
  expect(cache.get(scope.children[0])).toBeDefined();
  expect(compileInlineLocalLayout(scope,meter,cache)).toBe(layout);
  expect(Object.isFrozen(layout)).toBe(true);expect(Object.isFrozen(layout.variableNames)).toBe(true);
  controller.abort();expect(()=>compileInlineLocalLayout(scope,meter,cache)).toThrow(ExecutionLimitError);
});
it.each(["(x for x in xs)","def f():pass","class C:pass"])("rejects code-owning scopes as inline layouts: %s",source=>{
  const scope=analyzeModule(source).scopes.children[0];
  expect(()=>compileInlineLocalLayout(scope,new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}))).toThrow("inline layout requires a materialized comprehension");
});

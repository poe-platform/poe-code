import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {compileFunctionLocalLayout} from "./function-local-layout.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

const budget=()=>new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
it("freezes layout arrays independently of analysis collections",()=>{
  const scope=analyzeModule("def f(a):\n x=1\n return lambda:a+x").scopes.children[0],layout=compileFunctionLocalLayout(scope,budget());
  expect(Object.isFrozen(layout)).toBe(true);
  for(const names of [layout.variableNames,layout.cellNames,layout.freeNames])expect(Object.isFrozen(names)).toBe(true);
  expect(layout.variableNames).toEqual(["a"]);expect(layout.cellNames).toEqual(["a","x"]);
});
it("uses normalized Unicode code-point ordering for nonparameter cells",()=>{
  const scope=analyzeModule("def f():\n 𐐀=1\n ꭰ=2\n return lambda:𐐀+ꭰ").scopes.children[0];
  expect(compileFunctionLocalLayout(scope,budget()).cellNames).toEqual(["ꭰ","𐐀"]);
});
it("retains interpreter-owned comprehension activation boundaries",()=>{
  const scope=analyzeModule("def f(xs):return [x for x in xs]").scopes.children[0];
  expect(compileFunctionLocalLayout(scope,budget()).variableNames).toEqual(["xs"]);
});
it("rejects nonfunction code without allocating a layout",()=>{
  const scope=analyzeModule("x=1").scopes;
  expect(()=>compileFunctionLocalLayout(scope,budget())).toThrow("local layout requires function or lambda code");
});
it("checks cancellation before publishing a large layout",()=>{
  const scope=analyzeModule("def f("+Array.from({length:500},(_,i)=>"x"+i).join(",")+"):pass").scopes.children[0];
  expect(()=>compileFunctionLocalLayout(scope,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
  expect(compileFunctionLocalLayout(scope,budget()).variableNames).toHaveLength(500);
});

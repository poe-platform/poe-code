import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {compileCodeLocalLayout} from "./code-local-layout.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

const budget=()=>new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
it("freezes layout arrays independently of analysis collections",()=>{
  const scope=analyzeModule("def f(a):\n x=1\n return lambda:a+x").scopes.children[0],layout=compileCodeLocalLayout(scope,budget());
  expect(Object.isFrozen(layout)).toBe(true);
  for(const names of [layout.variableNames,layout.cellNames,layout.freeNames])expect(Object.isFrozen(names)).toBe(true);
  expect(layout.variableNames).toEqual(["a"]);expect(layout.cellNames).toEqual(["a","x"]);
});
it("uses normalized Unicode code-point ordering for nonparameter cells",()=>{
  const scope=analyzeModule("def f():\n 𐐀=1\n ꭰ=2\n return lambda:𐐀+ꭰ").scopes.children[0];
  expect(compileCodeLocalLayout(scope,budget()).cellNames).toEqual(["ꭰ","𐐀"]);
});
it("retains interpreter-owned comprehension activation boundaries",()=>{
  const scope=analyzeModule("def f(xs):return [x for x in xs]").scopes.children[0];
  expect(compileCodeLocalLayout(scope,budget()).variableNames).toEqual(["xs"]);
});
it("rejects comprehension activations without pretending they are native code",()=>{
  const scope=analyzeModule("[x for x in xs]").scopes.children[0];
  expect(()=>compileCodeLocalLayout(scope,budget())).toThrow("local layout requires a code-owning scope");
});
it.each([
  ["(x+y for x in xs for y in ys)",[".0","x","y"],[]],
  ["(lambda:x for x in xs)",[".0"],["x"]]
] as const)("lays out generator-expression iterator arguments and captures: %s",(source,variables,cells)=>{
  const layout=compileCodeLocalLayout(analyzeModule(source).scopes.children[0],budget());
  expect(layout.variableNames).toEqual(variables);expect(layout.cellNames).toEqual(cells);
  expect(layout.positionalCount).toBe(1);expect(layout.positionalOnlyCount).toBe(0);
  expect(layout.keywordOnlyCount).toBe(0);expect(layout.varPositional).toBe(false);expect(layout.varKeyword).toBe(false);
});
it("checks cancellation before publishing a large layout",()=>{
  const scope=analyzeModule("def f("+Array.from({length:500},(_,i)=>"x"+i).join(",")+"):pass").scopes.children[0];
  expect(()=>compileCodeLocalLayout(scope,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
  expect(compileCodeLocalLayout(scope,budget()).variableNames).toHaveLength(500);
});

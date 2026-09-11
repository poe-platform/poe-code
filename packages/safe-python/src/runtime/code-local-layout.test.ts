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
it("includes inlined comprehension slots in the enclosing code",()=>{
  const scope=analyzeModule("def f(xs):return [x for x in xs]").scopes.children[0];
  expect(compileCodeLocalLayout(scope,budget()).variableNames).toEqual(["xs","x"]);
});
it.each([
  ["[x for x in xs]",["x"],[]],
  ["[lambda:x for x in xs]",["x"],["x"]],
  ["[[y for y in x] for x in xs for z in xs]",["x","z","y"],[]],
  ["[x for x in [y for y in ys]]",["y","x"],[]],
  ["{x:y for x,y in xs}",["x","y"],[]],
  ["{x for x in xs}",["x"],[]]
] as const)("lays out module and class inline storage: %s",(source,variables,cells)=>{
  for(const text of [source,"class C:\n result="+source]){
    const root=analyzeModule(text).scopes,scope=text===source?root:root.children[0];
    const layout=compileCodeLocalLayout(scope,budget());
    expect(layout.variableNames).toEqual(variables);expect(layout.cellNames).toEqual(cells);
    expect(layout.positionalCount).toBe(0);
  }
});
it("reserves explicit global walrus names inside inlined scopes",()=>{
  const expression="[x for x in xs if (a:=x)]";
  for(const source of [expression,"def f(xs):\n global a\n return "+expression]){
    const root=analyzeModule(source).scopes,scope=source===expression?root:root.children[0];
    expect(compileCodeLocalLayout(scope,budget()).variableNames).toEqual(source===expression?["x","a"]:["xs","x","a"]);
  }
});
it("orders shared fast-local cells before cell-only storage",()=>{
  const scope=analyzeModule("def f(xs,z):\n a=1\n c=lambda:a\n return [lambda:(x,z) for x in xs]").scopes.children[0];
  expect(compileCodeLocalLayout(scope,budget()).cellNames).toEqual(["z","x","a"]);
});
it.each([
  ["return [x+z for x in xs]",["xs","z","x"],[]],
  ["a=1\nr=[a for x in xs]\nreturn a,r",["xs","z","a","x","r"],[]],
  ["x=1\nc=lambda:x\na=[lambda:x for x in xs]\nreturn c,a",["xs","z","c","x","a"],["x"]],
  ["return [[y for y in x] for x in xs for q in xs]",["xs","z","x","q","y"],[]],
  ["return [lambda:(x,z) for x in xs]",["xs","z","x"],["z","x"]],
  ["return [(x+y for y in xs) for x in xs]",["xs","z","x"],["x"]],
  ["return ([y for y in ys] for x in xs)",["xs","z"],[]]
] as const)("merges inline locals without synthetic captures: %s",(body,variables,cells)=>{
  const scope=analyzeModule("def f(xs,z):\n "+body.split("\n").join("\n ")).scopes.children[0];
  const layout=compileCodeLocalLayout(scope,budget());
  expect(layout.variableNames).toEqual(variables);expect(layout.cellNames).toEqual(cells);
});
it("includes nested inline slots in generator-expression code",()=>{
  const scope=analyzeModule("([y for y in ys] for x in xs)").scopes.children[0];
  expect(compileCodeLocalLayout(scope,budget()).variableNames).toEqual([".0","x","y"]);
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
it("budgets inline scope traversal and slot allocation",()=>{
  const names=Array.from({length:100},(_,index)=>"x"+index).join(",");
  const scope=analyzeModule("[0 for "+names+" in xs]").scopes;
  for(const limits of [{maxSteps:20,maxAllocatedBytes:100000},{maxSteps:10000,maxAllocatedBytes:1000}]){
    expect(()=>compileCodeLocalLayout(scope,new ExecutionBudget(limits))).toThrow(ExecutionLimitError);
  }
  expect(compileCodeLocalLayout(scope,budget()).variableNames).toHaveLength(100);
});
it("resolves the implicit generator iterator as a local parameter",()=>{
  const scope=analyzeModule("(x for x in xs)").scopes.children[0];
  expect(scope.bindings.get(".0")).toEqual({kind:"local",owner:scope.scope});
  expect(scope.scope.events[0]).toEqual(expect.objectContaining({kind:"parameter",name:".0"}));
});

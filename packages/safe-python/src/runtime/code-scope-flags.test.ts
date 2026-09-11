import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileCodeScopeFlags} from "./code-scope-flags.js";
import {compileProgram} from "./program-compilation.js";
import {compileFunction} from "./function-compilation.js";
import {compileClassBody} from "./class-compilation.js";

const budget=()=>new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
const constants={string:(value:string):unknown=>value,integer:(value:number):unknown=>value,tuple:(values:readonly unknown[]):unknown=>values};

it.each([
  ["def outer():\n global f\n def f():pass",[["<module>",0],["outer",3],["f",19]]],
  ["def outer():\n class C:\n  def f(self):pass",[["<module>",0],["outer",3],["outer.<locals>.C",0],["outer.<locals>.C.f",0x8000013]]],
  ["class C:\n f=lambda:1",[["<module>",0],["C",0],["C.<lambda>",0x8000003]]],
  ["class C:\n xs=[lambda:1 for x in []]",[["<module>",0],["C",0],["C.<lambda>",19]]],
  ["class C:\n xs=(x for x in [])",[["<module>",0],["C",0],["C.<genexpr>",0x8000003]]]
] as const)("derives scope flags from lexical ancestry: %s",(source,expected)=>{
  const analysis=analyzeModule(source),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
  const flags=compileCodeScopeFlags(analysis.scopes.scope,analysis.futureFeatures,meter);
  expect([...flags].filter(([scope])=>analysis.qualifiedNames.has(scope)).map(([scope,flags])=>[analysis.qualifiedNames.get(scope),flags])).toEqual(expected);
});

it.each([["",0],["annotations",0x1000000],["barry_as_FLUFL",0x400000],["division, generator_stop",0],["annotations, barry_as_FLUFL",0x1400000]] as const)("propagates active future flags %s",(features,future)=>{
  const analysis=analyzeModule((features?`from __future__ import ${features}\n`:"")+"class C:\n 'class doc'\n def f(self,*args,**kwargs):\n  'function doc'\n  yield 1"),program=compileProgram(analysis,{stripDocstring:false},constants,budget());
  expect(program.module.flags).toBe(future);
  expect([...program.classes.values()][0].flags).toBe(future);
  expect([...program.classFunctions.values()][0].flags).toBe(future);
  expect([...program.functions.values()][0].flags).toBe(future|0xc00002f);
  const cls=analysis.scopes.children[0],fn=cls.children[0];
  expect(compileClassBody(cls,analysis,{stripDocstring:false},constants,budget()).flags).toBe(future);
  expect(compileFunction(fn,analysis,{stripDocstring:false},constants,budget()).flags).toBe(future|0xc00002f);
});

it.each([false,true])("derives docstring presence from retained suite metadata (strip=%s)",stripDocstring=>{
  const analysis=analyzeModule("def f():\n 'doc'\n pass"),program=compileProgram(analysis,{stripDocstring},{...constants,string:()=>undefined},budget());
  expect([...program.functions.values()][0].flags).toBe(stripDocstring?3:0x4000003);
});

it("does not invent lexical flags for legacy partial analysis",()=>{
  const analysis=analyzeModule("def f():pass");
  expect(compileFunction(analysis.scopes.children[0],{qualifiedNames:analysis.qualifiedNames,functionKinds:analysis.functionKinds},{stripDocstring:false},constants,budget()).flags).toBeUndefined();
});

it("checks entry cancellation before inspecting the scope tree",()=>{
  const analysis=analyzeModule("def f():pass"),controller=new AbortController();controller.abort();
  expect(()=>compileCodeScopeFlags(analysis.scopes.scope,analysis.futureFeatures,new ExecutionBudget({signal:controller.signal,maxSteps:100,maxAllocatedBytes:1000}))).toThrow(ExecutionLimitError);
});

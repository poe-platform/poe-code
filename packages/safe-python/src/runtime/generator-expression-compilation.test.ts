import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {compileGeneratorExpression} from "./generator-expression-compilation.js";

const constants={string:(value:string):unknown=>value,integer:(value:number):unknown=>value,tuple:(values:readonly unknown[]):unknown=>values};
const budget=()=>new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});

it.each([1,2,3])("checks cancellation after constant allocation %s",stop=>{
  const analysis=analyzeModule("(x for x in xs)"),controller=new AbortController();let calls=0;
  const allocate=()=>{if(++calls===stop)controller.abort();return null;};
  expect(()=>compileGeneratorExpression(analysis.scopes.children[0],analysis,{filename:"x"},3,{...constants,string:allocate,integer:allocate},new ExecutionBudget({signal:controller.signal,maxSteps:10000,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
  expect(calls).toBe(stop);
});

it("rejects non-generator scopes and missing analyzed metadata",()=>{
  const analysis=analyzeModule("(x for x in xs)"),scope=analysis.scopes.children[0];
  expect(()=>compileGeneratorExpression(analysis.scopes,analysis,{filename:"x"},3,constants,budget())).toThrow("requires a generator scope");
  expect(()=>compileGeneratorExpression(scope,{qualifiedNames:new Map()},{filename:"x"},3,constants,budget())).toThrow("missing analyzed generator-expression metadata");
  expect(()=>compileGeneratorExpression(scope,analysis,{filename:"x"},undefined,constants,budget())).toThrow("missing analyzed generator-expression metadata");
});

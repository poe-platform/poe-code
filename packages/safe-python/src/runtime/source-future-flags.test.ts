import {expect,it} from "vitest";
import {compileSourceProgram,analyzeModule,parseExpression,PythonSyntaxError} from "../index.js";
import {ExecutionBudget} from "./execution-budget.js";
import {compileFunction} from "./function-compilation.js";
import {compileClassBody} from "./class-compilation.js";

const constants={string:(value:string):unknown=>value,integer:(value:number):unknown=>value,tuple:(values:readonly unknown[]):unknown=>values};
const options={stripDocstring:false,enterRecursiveCall:()=>()=>{}};
const budget=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:2000000});

it.each([0x20000,0x40000,0x80000,0x100000,0x200000,0x400000,0x800000,0x1000000,0x1fe0000])("preserves explicit future flags throughout nested code: %s",futureFlags=>{
  const program=compileSourceProgram("def f():return lambda:1\nclass C:pass\nx=(x for x in xs)",{...options,futureFlags},constants,budget());
  for(const code of [program.module,...program.functions.values(),...program.classes.values(),...program.generatorExpressions!.values()])expect(code.flags!&0x1fe0000).toBe(futureFlags);
});
it("uses inherited grammar in eval and keeps compilations isolated",()=>{
  const program=compileSourceProgram("1 <> 2",{...options,mode:"eval",futureFlags:0x400000},constants,budget());
  expect(program.module.expression).toMatchObject({kind:"comparison",operators:["!="]});
  expect(()=>compileSourceProgram("1 != 2",{...options,mode:"eval",futureFlags:0x400000},constants,budget())).toThrow(PythonSyntaxError);
  expect(()=>compileSourceProgram("1 <> 2",{...options,mode:"eval"},constants,budget())).toThrow(PythonSyntaxError);
  expect(parseExpression("1 <> 2",{futureFlags:0x400000}).kind).toBe("comparison");
});
it("combines directives with explicit flags without treating old directives as explicit bits",()=>{
  const program=compileSourceProgram("from __future__ import annotations, division\nx=1",{...options,futureFlags:0x800000},constants,budget());
  expect(program.module.flags).toBe(0x1800000);
});
it("preserves flags in independently compiled function and class metadata",()=>{
  const analysis=analyzeModule("def f():pass\nclass C:pass",{futureFlags:0x20000});
  expect(compileFunction(analysis.scopes.children[0],analysis,options,constants,budget()).flags!&0x20000).toBe(0x20000);
  expect(compileClassBody(analysis.scopes.children[1],analysis,options,constants,budget()).flags!&0x20000).toBe(0x20000);
});
it.each([-1,1,0x2000000,1.5,Number.MAX_SAFE_INTEGER])("rejects invalid future flag policies: %s",futureFlags=>{
  expect(()=>compileSourceProgram("pass",{...options,futureFlags},constants,budget())).toThrow(RangeError);
});
it("accepts the obsolete nested_scopes flag without mislabeling top-level code",()=>{
  expect(compileSourceProgram("pass",{...options,futureFlags:0x10},constants,budget()).module.flags).toBe(0);
});
it("snapshots inherited flags before callbacks can change caller options",()=>{
  const settings={...options,futureFlags:0x400000,onComment(){settings.futureFlags=0;}};
  const program=compileSourceProgram("# comment\nx=1 <> 2",settings,constants,budget());
  expect(settings.futureFlags).toBe(0);expect(program.module.flags).toBe(0x400000);
  const analysisSettings={futureFlags:0x400000,onComment(){analysisSettings.futureFlags=0;}};
  expect(analyzeModule("# comment\nx=1 <> 2",analysisSettings).futureFlags).toBe(0x400000);
});

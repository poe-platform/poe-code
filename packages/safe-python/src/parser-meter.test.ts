import {expect,it} from "vitest";
import {lex,type LexerOptions} from "./lexer.js";
import {parseExpression} from "./expression.js";
import {parseModule} from "./module.js";
import {analyzeModule} from "./analysis.js";
import {createTokenCursor} from "./token-cursor.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

const options=(meter:ExecutionBudget):LexerOptions=>({meter});
it.each([" ".repeat(10000),"#"+"x".repeat(10000),"x".repeat(10000),"'"+"x".repeat(10000)+"'"])("bounds lexing long input with a shared execution meter",source=>{
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000});
  expect(()=>[...lex(source,options(meter))]).toThrow(ExecutionLimitError);
});
it.each([parseExpression,parseModule,analyzeModule])("checks parser entry cancellation",parse=>{
  const controller=new AbortController();controller.abort();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>parse("x",options(meter))).toThrow(ExecutionLimitError);
});
it.each([false,true])("retains cancellation over comment callback failure=%s",fail=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>parseModule("# comment\nx=1",{meter,onComment(){controller.abort();if(fail)throw Error("callback");}})).toThrow(ExecutionLimitError);
});
it("bounds source-text extraction before copying the requested range",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000}),cursor=createTokenCursor("x".repeat(10000),{meter});
  expect(()=>cursor.sourceBetween(0,10000)).toThrow(ExecutionLimitError);
});
it("charges repeated buffered-token lookups rather than only new lexical work",()=>{
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}),cursor=createTokenCursor("x",options(meter));
  expect(()=>{for(let index=0;index<1000;index++)cursor.peek();}).toThrow(ExecutionLimitError);
});
it("charges parser cursor allocation before token buffering",()=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0});
  expect(()=>parseExpression("x",options(meter))).toThrow(ExecutionLimitError);
});
it("keeps cancellation fatal across speculative syntax recovery",()=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal}),cursor=createTokenCursor("x",options(meter));
  const error=cursor.error();
  expect(()=>cursor.attempt(()=>{controller.abort();throw error;})).toThrow(ExecutionLimitError);
});
it("retains ordinary ASTs and source locations with accounting enabled",()=>{
  const source="[x+1 for x in (1,2)]",meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  expect(parseExpression(source,options(meter))).toEqual(parseExpression(source));
  expect(meter.usage.steps).toBeGreaterThan(source.length);
  expect(meter.usage.allocatedBytes).toBeGreaterThan(0);
});
it.each(["unary","power","lambda"])("guards recursive %s grammar before host stack exhaustion",kind=>{
  const source=kind==="unary"?"-".repeat(10000)+"1":kind==="power"?"1**".repeat(10000)+"1":"lambda:".repeat(10000)+"1";
  let active=0,maximum=0;
  const enterRecursiveCall=()=>{if(active===40)throw new ExecutionLimitError("steps");active++;maximum=Math.max(maximum,active);return ()=>{active--;};};
  expect(()=>parseExpression(source,{enterRecursiveCall})).toThrow(ExecutionLimitError);
  expect(active).toBe(0);expect(maximum).toBe(40);
});
it.each(["1+2*3","(1+)"])("restores recursive parser accounting after %s",source=>{
  let active=0,entered=0;
  const enterRecursiveCall=()=>{active++;entered++;return ()=>{active--;};};
  try{parseExpression(source,{enterRecursiveCall});}catch(error){expect(error).toHaveProperty("name","SyntaxError");}
  expect(active).toBe(0);expect(entered).toBeGreaterThan(0);
});
it.each([
  "x=1\ny=x+2", "if True:\n x=1\nelse:\n x=2", "for x in (1,2):\n pass", "while x:\n break",
  "def f(a:int=1)->str:\n return a", "class C:\n __slots__=('x',)", "async def f():\n await g()",
  "try:\n x()\nexcept ValueError as e:\n raise\nfinally:\n pass", "with a as b:\n pass",
  "match value:\n case {'x': [a,*rest]}:\n  pass", "x=f'{value:{width}}'", "x=[a for a in xs if a]",
  "type Alias[T] = list[T]", "from __future__ import annotations\nx:A", "x=(1+)", "if x\n pass",
  "x='unterminated", "x=(", "# leading\nx = 1 # trailing", "x='a'\r\ny='b'\r"
])("preserves metered module parsing for %s",source=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  const parse=(settings:LexerOptions)=>{try{return parseModule(source,settings);}catch(error){return error;}};
  expect(parse({meter})).toEqual(parse({}));
  expect(meter.usage.steps).toBeGreaterThan(0);
});

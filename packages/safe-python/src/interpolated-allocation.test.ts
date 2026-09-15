import {expect,it} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readInterpolatedString} from "./interpolated-expression.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(['f""','t"text"','f"{a}"','f"{a=}"','f"{a!r}"','f"{a:}"','f"{a:{b}}"','f"{a,b}"','f"{*a,}"','t"{a=:{b}}"'])("charges interpolation AST storage independently of source extraction: %s",source=>{
  const tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<fields>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  cursor.sourceBetween=()=>"";active=true;
  expect(()=>readInterpolatedString(cursor,()=>{const token=cursor.take();return {kind:"name",name:token.text,spelling:token.text,start:token.start,end:token.end};})).toThrow(ExecutionLimitError);
});
it("meters replacement-field expression-text trimming",()=>{
  const source='f"{a}"',budget=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000});
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<fields>",source,[],budget);
  cursor.sourceBetween=()=>"a"+" ".repeat(10000);
  expect(()=>readInterpolatedString(cursor,()=>{const token=cursor.take();return {kind:"name",name:token.text,spelling:token.text,start:token.start,end:token.end};})).toThrow(ExecutionLimitError);
});
it("preserves cancellation from a throwing replacement-field reader",()=>{
  const source='f"{a}"',controller=new AbortController(),cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<fields>",source,[],
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  expect(()=>readInterpolatedString(cursor,()=>{controller.abort();throw new Error("field failure");})).toThrow(ExecutionLimitError);
});

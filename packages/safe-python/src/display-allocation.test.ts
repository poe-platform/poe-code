import {expect,it} from "vitest";
import type {Expression} from "./ast.js";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readDisplay} from "./displays.js";
import {readYield} from "./yield-expression.js";
import {readComprehensionClauses} from "./comprehensions.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

const cases=["()","[]","{}","(a)","(a,)","[a,b]","[*a]","{a,b}","{*a}","{a:b}","{**a}","{a:b,c:d}","(yield)","(yield from a)","(a for a in b)","[a for a in b]","{a for a in b}","{a:b for a in c}","yield","yield a","yield a,b","yield *a,","yield from a","for a in b","for a in b if c","async for a in b for c in d"];
it.each(cases)("charges display/yield/clause storage independently of child readers: %s",source=>{
  const tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<allocation>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const read=(cursor:TokenCursor):Expression=>{const token=cursor.take();return {kind:"name",name:token.text,spelling:token.text,start:token.start,end:token.end};};
  active=true;
  expect(()=>source.startsWith("yield")?readYield(cursor,read):source.startsWith("for")||source.startsWith("async")?
    readComprehensionClauses(cursor,read):readDisplay(cursor,read)).toThrow(ExecutionLimitError);
});
it.each(["[*a]","yield from a","for a in b"])("preserves cancellation from throwing child readers: %s",source=>{
  const controller=new AbortController(),cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<allocation>",source,[],
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const read=():Expression=>{controller.abort();throw new Error("child reader failure");};
  expect(()=>source.startsWith("yield")?readYield(cursor,read):source.startsWith("for")?
    readComprehensionClauses(cursor,read):readDisplay(cursor,read)).toThrow(ExecutionLimitError);
});

import {expect,it} from "vitest";
import type {Expression} from "./ast.js";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {parseExpression} from "./expression.js";
import {readTrailers,readArguments} from "./primary.js";
import {readNamedExpression} from "./named-expression.js";
import {normalizeNfkc} from "./normalization.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each([".a","()","(1)","(*1)","(**1)","(a=1)","(1,2)","[1]","[:]","[::]","[1:2:3]","[*1]","[1,2]"])("charges trailer storage independently of child readers: %s",source=>{
  const tokens=[...lex(source)],base=parseExpression("base"),normalization=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
  if(source===".a")normalizeNfkc("a",normalization);
  const budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8+normalization.usage.allocatedBytes});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<allocation>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const read=(cursor:TokenCursor):Expression=>{const token=cursor.take();return token.kind==="name"?
    {kind:"name",name:token.text,spelling:token.text,start:token.start,end:token.end}:
    {kind:"literal",literalKind:"integer",value:1n,start:token.start,end:token.end};};
  active=true;
  expect(()=>readTrailers(cursor,base,read)).toThrow(ExecutionLimitError);
});
it.each(["arguments","named"] as const)("preserves cancellation from throwing %s child readers",kind=>{
  const controller=new AbortController(),source=kind==="arguments"?"(1)":"a",tokens=[...lex(source)];
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<allocation>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const read=():Expression=>{controller.abort();throw new Error("child reader failure");};
  if(kind==="arguments")cursor.take();
  expect(()=>kind==="arguments"?readArguments(cursor,read,tokens[0]):readNamedExpression(cursor,read)).toThrow(ExecutionLimitError);
});
it("charges assignment-expression storage separately from child readers",()=>{
  const tokens=[...lex("a:=1")],nodes=[parseExpression("a"),parseExpression("1")];
  const budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false,index=0;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<allocation>","a:=1",[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  active=true;
  expect(()=>readNamedExpression(cursor,()=>{cursor.take();return nodes[index++];})).toThrow(ExecutionLimitError);
});

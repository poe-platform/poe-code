import {expect,it} from "vitest";
import type {Expression} from "./ast.js";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readParameters} from "./parameters.js";
import {readLambda} from "./lambda.js";
import {normalizeNfkc} from "./normalization.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each([
  ["",[]],["a",["a"]],["a,b",["a","b"]],["a,/,b",["a","b"]],
  ["*a",["a"]],["**a",["a"]],["a=1",["a"]],["*,a",["a"]],
  ["a:T",["a"]],["*a:*T",["a"]],["a:T=1",["a"]]
] as const)("charges parameter storage separately from normalization: %s",(parameters,names)=>{
  const source="("+parameters+")",tokens=[...lex(source)],normalization=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  for(const name of names)normalizeNfkc(name,normalization);
  const budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:normalization.usage.allocatedBytes+tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<parameters>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  cursor.take();active=true;
  expect(()=>readParameters(cursor,()=>{const token=cursor.take();return {kind:"name",name:token.text,spelling:token.text,start:token.start,end:token.end};},")")).toThrow(ExecutionLimitError);
});
it("charges lambda storage beyond the empty parameter list",()=>{
  const source="lambda:1",tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:96+tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<parameters>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  active=true;
  expect(()=>readLambda(cursor,()=>{const token=cursor.take();return {kind:"literal",literalKind:"integer",value:1n,start:token.start,end:token.end};})).toThrow(ExecutionLimitError);
});
it.each(["lambda:1","(a=1)","(a:T)"])("preserves cancellation from throwing body/default/annotation readers: %s",source=>{
  const controller=new AbortController(),cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<parameters>",source,[],
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const read=():Expression=>{controller.abort();throw new Error("reader failure");};
  if(source.startsWith("("))cursor.take();
  expect(()=>source.startsWith("lambda")?readLambda(cursor,read):readParameters(cursor,read,")")).toThrow(ExecutionLimitError);
});
it("charges positional-only copies after the slash is consumed",()=>{
  const source="(a,/)",budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:16});let active=false;
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<parameters>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const take=cursor.take.bind(cursor);
  cursor.take=()=>{const token=take();if(token.text==="/")active=true;return token;};
  cursor.take();
  expect(()=>readParameters(cursor,()=>{throw new Error("unexpected expression");},")")).toThrow(ExecutionLimitError);
});

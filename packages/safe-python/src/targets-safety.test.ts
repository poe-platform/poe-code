import {expect,it} from "vitest";
import type {Expression} from "./ast.js";
import {parseExpression} from "./expression.js";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readLoopTarget,validateTarget} from "./targets.js";
import {ExecutionBudget,ExecutionLimitError,type ExecutionLimits} from "./runtime/execution-budget.js";

function fixture(limits:ExecutionLimits,source=""){
  const budget=new ExecutionBudget(limits),tokens=[...lex(source)];let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<targets>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  active=true;return {cursor,budget};
}
it.each(["steps","allocation","cancelled"] as const)("enforces target validation entry %s limits",reason=>{
  const controller=new AbortController();if(reason==="cancelled")controller.abort();
  const {cursor}=fixture({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>validateTarget(parseExpression("a"),cursor)).toThrow(ExecutionLimitError);
});
it("validates 50000 nested target collections without host recursion",()=>{
  let target:Expression=parseExpression("a");
  for(let i=0;i<50000;i++)target={kind:"tuple",items:[target],start:target.start,end:target.end};
  const {cursor}=fixture({maxSteps:1000000,maxAllocatedBytes:10000000});
  expect(()=>validateTarget(target,cursor)).not.toThrow();
});
it.each(["a in b","a,b in c","a,*b in c"])("charges loop-target storage independently of child readers: %s",source=>{
  const {cursor}=fixture({maxSteps:10000,maxAllocatedBytes:[...lex(source)].length*8},source);
  expect(()=>readLoopTarget(cursor,()=>{const token=cursor.take();return {kind:"name",name:token.text,spelling:token.text,start:token.start,end:token.end};})).toThrow(ExecutionLimitError);
});
it("preserves cancellation from a throwing loop-target reader",()=>{
  const controller=new AbortController(),{cursor}=fixture({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal},"a in b");
  expect(()=>readLoopTarget(cursor,()=>{controller.abort();throw new Error("reader failure");})).toThrow(ExecutionLimitError);
});
it("bounds cyclic external target graphs",()=>{
  const leaf=parseExpression("a"),items:Expression[]=[],target:Expression={kind:"tuple",items,start:leaf.start,end:leaf.end};items.push(target);
  const {cursor}=fixture({maxSteps:100,maxAllocatedBytes:100000});
  expect(()=>validateTarget(target,cursor)).toThrow(ExecutionLimitError);
});
it("charges nested validation frame storage",()=>{
  const target=parseExpression("[[a]]"),{cursor}=fixture({maxSteps:10000,maxAllocatedBytes:200});
  expect(()=>validateTarget(target,cursor)).toThrow(ExecutionLimitError);
});

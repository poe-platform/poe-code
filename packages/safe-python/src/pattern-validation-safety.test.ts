import {expect,it} from "vitest";
import type {Pattern} from "./pattern-ast.js";
import {parsePattern} from "./patterns.js";
import {validatePattern} from "./pattern-validation.js";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["_","x","1","[x]","x as y","1 | 2","{}","C(x)"])("charges pattern validation storage: %s",source=>{
  const pattern=parsePattern(source),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0});let active=false;
  const cursor=new TokenCursor(lex("")[Symbol.iterator](),"<validation>","",[],{checkpoint:(steps,bytes)=>{if(active)meter.checkpoint(steps,bytes);}});active=true;
  expect(()=>validatePattern(pattern,cursor)).toThrow(ExecutionLimitError);
});
it("bounds wide external pattern traversal",()=>{
  const leaf=parsePattern("_"),pattern:Pattern={kind:"sequence",items:Array(10000).fill(leaf),start:leaf.start,end:leaf.end};
  const cursor=new TokenCursor(lex("")[Symbol.iterator](),"<validation>","",[],new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}));
  expect(()=>validatePattern(pattern,cursor)).toThrow(ExecutionLimitError);
});
it("validates deeply nested external patterns without the host stack",()=>{
  let pattern=parsePattern("_");for(let index=0;index<50000;index++)pattern={kind:"sequence",items:[pattern],start:pattern.start,end:pattern.end};
  const cursor=new TokenCursor(lex("")[Symbol.iterator](),"<validation>","",[],new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:100000000}));
  expect(validatePattern(pattern,cursor)).toBe(false);
});
it("bounds cyclic external pattern traversal",()=>{
  const pattern=parsePattern("[]");Object.assign(pattern,{items:[pattern]});
  const cursor=new TokenCursor(lex("")[Symbol.iterator](),"<validation>","",[],new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}));
  expect(()=>validatePattern(pattern,cursor)).toThrow(ExecutionLimitError);
});
it.each([false,true])("preserves cancellation from validation accessors (throws=%s)",throws=>{
  const pattern=parsePattern("_"),controller=new AbortController();
  Object.defineProperty(pattern,"kind",{get:()=>{controller.abort();if(throws)throw new Error("accessor failure");return "capture";}});
  const cursor=new TokenCursor(lex("")[Symbol.iterator](),"<validation>","",[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  expect(()=>validatePattern(pattern,cursor)).toThrow(ExecutionLimitError);
});

import {expect,it} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readExpression} from "./expression.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["1","1.5","1j","True","False","None","...","+1","-1","~1","not 1","await 1","1+2","1 and 2","1 if 2 else 3","1<2<3","1 is not 2","1 not in 2"])("charges AST allocation independently of token production: %s",source=>{
  const tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});
  let active=false;
  const meter={checkpoint:(steps?:number,bytes?:number)=>{if(active)budget.checkpoint(steps,bytes);}};
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<allocation>",source,[],meter);
  active=true;
  expect(()=>readExpression(cursor)).toThrow(ExecutionLimitError);
});
it.each([false,true])("preserves cancellation from the recursion-exit callback (throws=%s)",throws=>{
  const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const cursor=new TokenCursor(lex("1")[Symbol.iterator](),"<allocation>","1",[],budget,()=>()=>{
    controller.abort();if(throws)throw new Error("exit callback failure");
  });
  expect(()=>readExpression(cursor)).toThrow(ExecutionLimitError);
});
it.each([["+1",1],["await 1",1],["1+2",2],["1 and 2",2],["1<2<3",3],["1 if 2 else 3",3]] as const)("charges composite storage beyond its literal operands: %s",(source,literals)=>{
  const tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8+literals*80});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<allocation>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  active=true;
  expect(()=>readExpression(cursor)).toThrow(ExecutionLimitError);
});
it("preserves cancellation from a throwing recursion-entry callback",()=>{
  const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const cursor=new TokenCursor(lex("1")[Symbol.iterator](),"<allocation>","1",[],budget,()=>{
    controller.abort();throw new Error("entry callback failure");
  });
  expect(()=>readExpression(cursor)).toThrow(ExecutionLimitError);
});
it("retains ordinary recursion-exit errors",()=>{
  const failure=new Error("exit callback failure"),cursor=new TokenCursor(lex("1")[Symbol.iterator](),"<allocation>","1",[],
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),()=>()=>{throw failure;});
  expect(()=>readExpression(cursor)).toThrow(failure);
});

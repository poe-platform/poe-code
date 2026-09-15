import {expect,it,vi} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readPatternLiteral} from "./pattern-literals.js";
import {parseExpression} from "./expression.js";
import * as strings from "./string-expressions.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["True","False","None","1","1.5","2j","-1","-2j","1+2j","-1-2j"])("charges pattern literal AST allocation after tokenization: %s",source=>{
  const tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<literals>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});active=true;
  expect(()=>readPatternLiteral(cursor)).toThrow(ExecutionLimitError);
});
it.each([false,true])("preserves cancellation from a delegated string reader (throws=%s)",throws=>{
  const source='"value"',value=parseExpression(source),controller=new AbortController();
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<literals>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const spy=vi.spyOn(strings,"readStringExpression").mockImplementation(()=>{controller.abort();if(throws)throw new Error("string failure");return value;});
  try{expect(()=>readPatternLiteral(cursor)).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it("charges integer-to-complex conversion work independently of tokenization",()=>{
  const source="9".repeat(300)+"+2j",tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<literals>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});active=true;
  expect(()=>readPatternLiteral(cursor)).toThrow(ExecutionLimitError);
});

import {expect,it,vi} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readSimpleStatement} from "./simple-statements.js";
import {readAssignmentOrExpression,readStatementValue} from "./assignment-statements.js";
import * as expressions from "./expression.js";
import * as targets from "./targets.js";
import * as normalization from "./normalization.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["pass","break","continue","return","return a","raise","raise a","raise a from b","assert a","assert a,b","global a,b","nonlocal a","del a,b","a","a=b","a=b=c","a:T","a:T=b","a+=b","a,b=c","*a,b=c"])("charges simple/assignment storage independently of delegated readers: %s",source=>{
  const tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<simple>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const spies=[vi.spyOn(expressions,"readExpression").mockImplementation(cursor=>{const token=cursor.take();return {kind:"name",name:token.text,spelling:token.text,start:token.start,end:token.end};}),
    vi.spyOn(targets,"validateTarget").mockImplementation(()=>{}),vi.spyOn(normalization,"normalizeNfkc").mockImplementation(value=>value)];
  active=true;
  try{expect(()=>readSimpleStatement(cursor)).toThrow(ExecutionLimitError);}finally{for(const spy of spies)spy.mockRestore();}
});
it.each(["a","a,b","*a,b"])("charges statement-value storage separately: %s",source=>{
  const tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<simple>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const spy=vi.spyOn(expressions,"readExpression").mockImplementation(cursor=>{const token=cursor.take();return {kind:"name",name:token.text,spelling:token.text,start:token.start,end:token.end};});active=true;
  try{expect(()=>readStatementValue(cursor)).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it.each(["simple","assignment","value"] as const)("preserves cancellation from throwing %s child readers",kind=>{
  const source=kind==="simple"?"assert a":"a",controller=new AbortController(),cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<simple>",source,[],
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const spy=vi.spyOn(expressions,"readExpression").mockImplementation(()=>{controller.abort();throw new Error("child reader failure");});
  try{expect(()=>kind==="simple"?readSimpleStatement(cursor):kind==="assignment"?readAssignmentOrExpression(cursor):readStatementValue(cursor)).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});

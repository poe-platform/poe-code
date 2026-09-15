import {expect,it,vi} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {parseModule} from "./module.js";
import {parseExpression} from "./expression.js";
import {readFunction} from "./function-statements.js";
import {readClass} from "./class-statements.js";
import * as parameters from "./parameters.js";
import * as primary from "./primary.js";
import * as normalization from "./normalization.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["def f():","class C:","class C():"])("charges definition storage independently of delegated metadata readers: %s",source=>{
  const tokens=[...lex(source)],body=parseModule("pass").body,budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<definitions>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const spies=[vi.spyOn(parameters,"readParameters").mockImplementation(cursor=>{cursor.expect(")");return [];}),
    vi.spyOn(primary,"readArguments").mockReturnValue([]),vi.spyOn(normalization,"normalizeNfkc").mockImplementation(value=>value)];active=true;
  try{expect(()=>source.startsWith("def")?readFunction(cursor,()=>body):readClass(cursor,()=>body)).toThrow(ExecutionLimitError);}finally{for(const spy of spies)spy.mockRestore();}
});
it.each([["function",false],["function",true],["class",false],["class",true]] as const)("preserves %s suite-reader cancellation (throws=%s)",(kind,throws)=>{
  const source=kind==="function"?"def f():":"class C:",body=parseModule("pass").body,controller=new AbortController();
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<definitions>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const readSuite=()=>{controller.abort();if(throws)throw new Error("suite failure");return body;};
  expect(()=>kind==="function"?readFunction(cursor,readSuite):readClass(cursor,readSuite)).toThrow(ExecutionLimitError);
});
it.each(["function","class"] as const)("borrows supplied %s decorators and suite",kind=>{
  const source=kind==="function"?"def f():":"class C:",body=parseModule("pass").body,decorators=[parseExpression("decorate")];
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<definitions>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}));
  const node=kind==="function"?readFunction(cursor,()=>body,undefined,decorators):readClass(cursor,()=>body,decorators);
  if(node.kind!=="function"&&node.kind!=="class")throw new Error("expected definition");
  expect(node.decorators).toBe(decorators);expect(node.body).toBe(body);
});

import {expect,it,vi} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {parseModule} from "./module.js";
import {readMatch} from "./match-statements.js";
import * as expressions from "./expression.js";
import * as named from "./named-expression.js";
import * as patterns from "./patterns.js";
import * as validation from "./pattern-validation.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["x","x,","x,y","*x,","x,*y"])("charges match storage independently of delegated readers: %s",subject=>{
  const source=`match ${subject}:\n case _: pass`,tokens=[...lex(source)],body=parseModule("pass").body,value=expressions.parseExpression("x"),pattern=patterns.parsePattern("_");
  const budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8+128});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<match>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const expression=(cursor:TokenCursor)=>{cursor.take();return value;};
  const spies=[vi.spyOn(expressions,"readExpression").mockImplementation(expression),vi.spyOn(named,"readNamedExpression").mockImplementation(expression),
    vi.spyOn(patterns,"readPatterns").mockImplementation(cursor=>{cursor.take();return pattern;}),vi.spyOn(validation,"validatePattern").mockReturnValue(true)];
  const suite=(cursor:TokenCursor)=>{cursor.expect(":");cursor.expect("pass");if(cursor.peek().kind==="newline")cursor.take();return body;};active=true;
  try{expect(()=>readMatch(cursor,suite)).toThrow(ExecutionLimitError);}finally{for(const spy of spies)spy.mockRestore();}
});
it.each(["pattern","validation","suite"] as const)("preserves cancellation from a throwing match %s reader",stage=>{
  const source="match x:\n case _: pass",controller=new AbortController();
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<match>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const fail=()=>{controller.abort();throw new Error("child failure");};
  const spy=stage==="pattern"?vi.spyOn(patterns,"readPatterns").mockImplementation(fail):stage==="validation"?vi.spyOn(validation,"validatePattern").mockImplementation(fail):undefined;
  try{expect(()=>readMatch(cursor,fail)).toThrow(ExecutionLimitError);}finally{spy?.mockRestore();}
});
it("preserves match as an ordinary identifier",()=>{
  const source="match + 1",cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<match>",source);
  expect(readMatch(cursor,()=>{throw new Error("unexpected suite");})).toBeUndefined();expect(cursor.peek().text).toBe("match");
});

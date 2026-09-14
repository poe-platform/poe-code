import {expect,it,vi} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readTypeParameters} from "./type-parameters.js";
import {readTypeAlias} from "./type-aliases.js";
import * as expressions from "./expression.js";
import * as normalization from "./normalization.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["[T]","[T,U,*Ts,**P]","type Alias = int"])("charges ignored type storage independently of child readers: %s",source=>{
  const tokens=[...lex(source)],value=expressions.parseExpression("int"),budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<types>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const spies=[vi.spyOn(normalization,"normalizeNfkc").mockImplementation(value=>value),vi.spyOn(expressions,"readExpression").mockReturnValue(value)];active=true;
  try{expect(()=>source.startsWith("[")?readTypeParameters(cursor):readTypeAlias(cursor)).toThrow(ExecutionLimitError);}finally{for(const spy of spies)spy.mockRestore();}
});
it.each(["[T: Bound]","[T = Default]","type Alias = int"])("preserves cancellation from throwing ignored expression readers: %s",source=>{
  const controller=new AbortController(),cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<types>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const spy=vi.spyOn(expressions,"readExpression").mockImplementation(()=>{controller.abort();throw new Error("expression failure");});
  try{expect(()=>source.startsWith("[")?readTypeParameters(cursor):readTypeAlias(cursor)).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it("preserves cancellation when an alias expression reader returns",()=>{
  const source="type Alias = int",value=expressions.parseExpression("int"),controller=new AbortController();
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<types>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const spy=vi.spyOn(expressions,"readExpression").mockImplementation(()=>{controller.abort();return value;});
  try{expect(()=>readTypeAlias(cursor)).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it("retains the ordinary type identifier grammar alternative",()=>{
  const source="type + 1",cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<types>",source);
  expect(readTypeAlias(cursor)).toBeUndefined();expect(cursor.peek().text).toBe("type");
});

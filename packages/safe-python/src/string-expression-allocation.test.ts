import {expect,it} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readStringExpression} from "./string-expressions.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(['"x"','b"x"','f"x"','t"x"','"a" "b"','b"a" b"b"','"a" f"b"','t"a" t"b"'])("charges string AST storage independently of lexing: %s",source=>{
  const tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<strings>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});active=true;
  expect(()=>readStringExpression(cursor,()=>{throw new Error("unexpected field");})).toThrow(ExecutionLimitError);
});
it.each(["steps","allocation"] as const)("charges adjacent buffer copy %s",limit=>{
  const source='"a" "b"',tokens=[...lex(source)].map(token=>token.kind==="string"?{...token,value:new Uint32Array(1000)}:token);
  const budget=new ExecutionBudget({maxSteps:limit==="steps"?100:100000,maxAllocatedBytes:limit==="allocation"?1000:100000});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<strings>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});active=true;
  expect(()=>readStringExpression(cursor,()=>{throw new Error("unexpected field");})).toThrow(ExecutionLimitError);
});
it("preserves cancellation from a throwing interpolation reader",()=>{
  const source='f"{a}"',controller=new AbortController();
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<strings>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  expect(()=>readStringExpression(cursor,()=>{controller.abort();throw new Error("field failure");})).toThrow(ExecutionLimitError);
});
it("borrows a single literal buffer without copying it",()=>{
  const source='"abc"',tokens=[...lex(source)],first=tokens[0];
  if(first.kind!=="string")throw new Error("expected string");
  const result=readStringExpression(new TokenCursor(tokens[Symbol.iterator](),"<strings>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000})),()=>{throw new Error("unexpected field");});
  expect(result.kind==="literal"&&result.value).toBe(first.value);
});

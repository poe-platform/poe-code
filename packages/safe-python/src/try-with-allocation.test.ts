import {expect,it,vi} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {parseModule} from "./module.js";
import {readTry} from "./try-statements.js";
import {readWith} from "./with-statements.js";
import * as expressions from "./expression.js";
import * as normalization from "./normalization.js";
import * as targets from "./targets.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["try: pass\nfinally: pass","try: pass\nexcept: pass","try: pass\nexcept E as e: pass","try: pass\nexcept E,F: pass","try: pass\nexcept* E: pass","with x: pass","with x as y: pass","with x,y: pass","with (x,y,): pass"])("charges try/with storage independently of child readers: %s",source=>{
  const tokens=[...lex(source)],body=parseModule("pass").body,value=expressions.parseExpression("x"),budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8+(source.startsWith("with (")?128:0)});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<blocks>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const spies=[vi.spyOn(expressions,"readExpression").mockImplementation(cursor=>{cursor.take();return value;}),vi.spyOn(normalization,"normalizeNfkc").mockImplementation(value=>value),vi.spyOn(targets,"validateTarget").mockImplementation(()=>{})];
  const suite=(cursor:TokenCursor)=>{cursor.expect(":");cursor.expect("pass");if(cursor.peek().kind==="newline")cursor.take();return body;};active=true;
  try{expect(()=>source.startsWith("try")?readTry(cursor,suite):readWith(cursor,suite)).toThrow(ExecutionLimitError);}finally{for(const spy of spies)spy.mockRestore();}
});
it.each(["try","with"] as const)("preserves cancellation from a throwing %s suite reader",kind=>{
  const source=kind==="try"?"try: pass":"with x: pass",controller=new AbortController();
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<blocks>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const suite=()=>{controller.abort();throw new Error("suite failure");};
  expect(()=>kind==="try"?readTry(cursor,suite):readWith(cursor,suite)).toThrow(ExecutionLimitError);
});
it.each(["try","with"] as const)("preserves cancellation from the final returning %s suite reader",kind=>{
  const source=kind==="try"?"try: pass\nfinally: pass":"with x: pass",body=parseModule("pass").body,controller=new AbortController();let calls=0;
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<blocks>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const suite=(cursor:TokenCursor)=>{cursor.expect(":");cursor.expect("pass");if(cursor.peek().kind==="newline")cursor.take();if(++calls===(kind==="try"?2:1))controller.abort();return body;};
  expect(()=>kind==="try"?readTry(cursor,suite):readWith(cursor,suite)).toThrow(ExecutionLimitError);
});

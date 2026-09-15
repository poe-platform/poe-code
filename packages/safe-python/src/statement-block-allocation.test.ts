import {expect,it,vi} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readStatements} from "./compound-statements.js";
import * as named from "./named-expression.js";
import * as targets from "./targets.js";
import * as assignments from "./assignment-statements.js";
import * as blocks from "./compound-statements.js";
import * as cursors from "./token-cursor.js";
import {parseModule} from "./module.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["","pass","pass;pass","pass\npass","if x:pass","if x:pass\nelif y:pass\nelse:pass","while x:pass","for a in b:pass","async for a in b:pass"])("charges block/compound storage independently of expression readers: %s",source=>{
  const tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<blocks>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const read=(cursor:TokenCursor)=>{const token=cursor.take();return {kind:"name" as const,name:token.text,spelling:token.text,start:token.start,end:token.end};};
  const spies=[vi.spyOn(named,"readNamedExpression").mockImplementation(read),vi.spyOn(targets,"readLoopTarget").mockImplementation(read),vi.spyOn(assignments,"readStatementValue").mockImplementation(read)];
  active=true;
  try{expect(()=>readStatements(cursor)).toThrow(ExecutionLimitError);}finally{for(const spy of spies)spy.mockRestore();}
});
it("reserves the module node independently of cursor/block construction",()=>{
  const cursor=new TokenCursor(lex("")[Symbol.iterator]()),cursorSpy=vi.spyOn(cursors,"createTokenCursor").mockReturnValue(cursor),blockSpy=vi.spyOn(blocks,"readStatements").mockReturnValue([]);
  try{expect(()=>parseModule("",{meter:new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0})})).toThrow(ExecutionLimitError);}finally{cursorSpy.mockRestore();blockSpy.mockRestore();}
});
it("preserves cancellation from a throwing compound child reader",()=>{
  const controller=new AbortController(),cursor=new TokenCursor(lex("if x:pass")[Symbol.iterator](),"<blocks>","if x:pass",[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const spy=vi.spyOn(named,"readNamedExpression").mockImplementation(()=>{controller.abort();throw new Error("child reader failure");});
  try{expect(()=>readStatements(cursor)).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});

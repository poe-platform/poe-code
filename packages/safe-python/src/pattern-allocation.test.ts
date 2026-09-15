import {expect,it,vi} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {parsePattern,readPatterns} from "./patterns.js";
import {parseExpression} from "./expression.js";
import * as normalization from "./normalization.js";
import * as literals from "./pattern-literals.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["_","x","x,","*x,","[]","()","[x,*rest]","(x)","1","True","A.value","1 | 2","x as y","{}","{1:x}","{**rest}","C()","C(key=x)"])("charges pattern storage independently of literal/name readers: %s",source=>{
  const tokens=[...lex(source)],value=parseExpression("1"),budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8+(source.startsWith("C(")?128:0)});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<patterns>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const spies=[vi.spyOn(normalization,"normalizeNfkc").mockImplementation(value=>value),vi.spyOn(literals,"readPatternLiteral").mockImplementation(cursor=>{cursor.take();return value;})];active=true;
  try{expect(()=>readPatterns(cursor)).toThrow(ExecutionLimitError);}finally{for(const spy of spies)spy.mockRestore();}
});
it.each(["sequence","mapping","class"] as const)("honors caller recursion limits for nested %s patterns",kind=>{
  let source="_";for(let index=0;index<20;index++)source=kind==="sequence"?`[${source}]`:kind==="mapping"?`{1:${source}}`:`C(${source})`;
  let depth=0;
  expect(()=>parsePattern(source,{enterRecursiveCall:()=>{if(depth===3)throw new Error("pattern recursion limit");depth++;return()=>{depth--;};}})).toThrow("pattern recursion limit");
  expect(depth).toBe(0);
});
it.each(["entry","exit"] as const)("preserves cancellation from throwing recursion %s callbacks",stage=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const fail=()=>{controller.abort();throw new Error("recursion callback failure");};
  expect(()=>parsePattern("_",{meter,enterRecursiveCall:()=>{if(stage==="entry")fail();return fail;}})).toThrow(ExecutionLimitError);
});
it("restores recursion depth after malformed nested patterns",()=>{
  let depth=0,entered=0;
  expect(()=>parsePattern("[C(key=)]",{enterRecursiveCall:()=>{depth++;entered++;return()=>{depth--;};}})).toThrow(SyntaxError);
  expect(entered).toBeGreaterThan(0);expect(depth).toBe(0);
});
it.each(["sequence","mapping","class"] as const)("retains deeply nested valid %s patterns within the caller limit",kind=>{
  let source="_";for(let index=0;index<100;index++)source=kind==="sequence"?`[${source}]`:kind==="mapping"?`{1:${source}}`:`C(${source})`;
  let depth=0,maximum=0;
  expect(()=>parsePattern(source,{enterRecursiveCall:()=>{depth++;maximum=Math.max(maximum,depth);return()=>{depth--;};}})).not.toThrow();
  expect(maximum).toBe(101);expect(depth).toBe(0);
});

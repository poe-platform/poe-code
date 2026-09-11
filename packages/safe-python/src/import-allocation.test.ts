import {expect,it,vi} from "vitest";
import {lex} from "./lexer.js";
import {TokenCursor} from "./token-cursor.js";
import {readImportStatement} from "./import-statements.js";
import * as normalization from "./normalization.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["import a","import a.b as c, d","from a.b import c as d, e","from ... import *","from a import (b,c,)","from __future__ import annotations"])("charges import records independently of normalization: %s",source=>{
  const tokens=[...lex(source)],budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:tokens.length*8});let active=false;
  const cursor=new TokenCursor(tokens[Symbol.iterator](),"<imports>",source,[],{checkpoint:(steps,bytes)=>{if(active)budget.checkpoint(steps,bytes);}});
  const spy=vi.spyOn(normalization,"normalizeNfkc").mockImplementation(value=>value);active=true;
  try{expect(()=>readImportStatement(cursor)).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it.each([false,true])("preserves cancellation from future-feature publication (throws=%s)",throws=>{
  const source="from __future__ import annotations",controller=new AbortController();
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<imports>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const spy=vi.spyOn(cursor.futureFeatures,"add").mockImplementation(()=>{controller.abort();if(throws)throw new Error("publication failure");return cursor.futureFeatures;});
  try{expect(()=>readImportStatement(cursor)).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it("preserves cancellation from throwing import normalization",()=>{
  const source="import module",controller=new AbortController();
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<imports>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}));
  const spy=vi.spyOn(normalization,"normalizeNfkc").mockImplementation(()=>{controller.abort();throw new Error("normalization failure");});
  try{expect(()=>readImportStatement(cursor)).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it("retains future feature names independently of aliases and duplicates",()=>{
  const source="from __future__ import annotations as a, annotations, division";
  const cursor=new TokenCursor(lex(source)[Symbol.iterator](),"<imports>",source,[],new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}));
  readImportStatement(cursor);expect([...cursor.futureFeatures]).toEqual(["annotations","division"]);
});

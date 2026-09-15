import {expect,it,vi} from "vitest";
import {parseModule} from "./module.js";
import {analyzeModule} from "./analysis.js";
import {validateFutureImports} from "./future-imports.js";
import * as futureImports from "./future-imports.js";
import type {Statement} from "./statement-ast.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["steps","allocation","cancelled"] as const)("checks future validation entry %s limits",reason=>{
  const module=parseModule("pass"),controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>validateFutureImports(module,"<string>",meter)).toThrow(ExecutionLimitError);
});
it("walks deeply nested external syntax trees without host recursion",()=>{
  const module=parseModule("pass"),template=parseModule("with x:pass").body[0];
  if(template.kind!=="with")throw Error("fixture");
  let statement:Statement=module.body[0];for(let i=0;i<10000;i++)statement={...template,body:[statement]};
  expect([...validateFutureImports({...module,body:[statement]},"<string>",new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000}))]).toEqual([]);
});
it("bounds a wide body containing no executable expressions",()=>{
  const module=parseModule("pass");
  expect(()=>validateFutureImports({...module,body:Array(10000).fill(module.body[0])},"<string>",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("meters empty conditional branches that yield no child statements",()=>{
  const module=parseModule("if x:pass"),statement=module.body[0];if(statement.kind!=="if")throw Error("fixture");
  const branch={...statement.branches[0],body:[]};
  expect(()=>validateFutureImports({...module,body:[{...statement,branches:Array(10000).fill(branch)}]},"<string>",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("meters repeated future feature names even after deduplication",()=>{
  const module=parseModule("from __future__ import annotations"),statement=module.body[0];if(statement.kind!=="import-from"||statement.imports==="*")throw Error("fixture");
  expect(()=>validateFutureImports({...module,body:[{...statement,imports:Array(10000).fill(statement.imports[0])}]},"<string>",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("charges syntax diagnostics before constructing them",()=>{
  const module=parseModule("from __future__ import unknown");
  expect(()=>validateFutureImports(module,"<string>",{checkpoint(_steps=1,bytes=0){if(bytes>=256)throw new ExecutionLimitError("allocation");}})).toThrow(ExecutionLimitError);
});
it("forwards the analysis meter to future validation",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),spy=vi.spyOn(futureImports,"validateFutureImports");
  try{analyzeModule("pass",{meter});expect(spy.mock.calls[0][2]).toBe(meter);}finally{spy.mockRestore();}
});
it.each(["try:\n pass\nexcept Exception:pass","match x:\n case _:pass"])("meters empty nested bodies in %s",source=>{
  const module=parseModule(source),statement=module.body[0];
  const wide=statement.kind==="try"?{...statement,handlers:Array(10000).fill({...statement.handlers[0],body:[]})}
    :statement.kind==="match"?{...statement,cases:Array(10000).fill({...statement.cases[0],body:[]})}:statement;
  expect(()=>validateFutureImports({...module,body:[wide]},"<string>",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("bounds cyclic external trees with the execution meter",()=>{
  const module=parseModule("with x:pass"),statement=module.body[0];if(statement.kind!=="with")throw Error("fixture");
  const body:Statement[]=[],cyclic={...statement,body};body.push(cyclic);
  expect(()=>validateFutureImports({...module,body},"<string>",new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("preserves depth-first nested directive diagnostic order",()=>{
  const module=parseModule("if x:\n with y:\n  from __future__ import unknown\n from __future__ import braces");
  expect(()=>validateFutureImports(module,"order.py",new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:1000000}))).toThrow(expect.objectContaining({filename:"order.py",position:expect.objectContaining({line:3,column:2})}));
});

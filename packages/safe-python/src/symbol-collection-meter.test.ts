import {expect,it,vi} from "vitest";
import {parseModule} from "./module.js";
import {collectSymbols} from "./symbol-collection.js";
import * as symbols from "./symbol-collection.js";
import {analyzeModule} from "./analysis.js";
import type {Statement} from "./statement-ast.js";
import type {Expression} from "./ast.js";
import type {Pattern} from "./pattern-ast.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["steps","allocation","cancelled"] as const)("checks symbol collection entry %s limits",reason=>{
  const module=parseModule("pass"),controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>collectSymbols(module,meter)).toThrow(ExecutionLimitError);
});
it("collects 10000 nested statements without host recursion",()=>{
  const module=parseModule("def f():pass"),template=module.body[0];if(template.kind!=="function")throw Error("fixture");
  let statement:Statement=template;for(let i=0;i<10000;i++)statement={...template,body:[statement]};
  expect(()=>collectSymbols({...module,body:[statement]},new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:20000000}))).not.toThrow();
});
it("collects 10000 nested expressions without host recursion",()=>{
  const module=parseModule("not x"),statement=module.body[0];if(statement.kind!=="expression-statement"||statement.expression.kind!=="unary")throw Error("fixture");
  const template=statement.expression;let expression:Expression=template;for(let i=0;i<10000;i++)expression={...template,operand:expression};
  expect(collectSymbols({...module,body:[{...statement,expression}]},new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:20000000})).events.map(event=>event.name)).toEqual(["x"]);
});
it("collects 10000 nested assignment targets without host recursion",()=>{
  const module=parseModule("x = value"),statement=module.body[0];if(statement.kind!=="assignment")throw Error("fixture");
  let target=statement.targets[0];for(let i=0;i<10000;i++)target={kind:"tuple",items:[target],start:target.start,end:target.end};
  expect(collectSymbols({...module,body:[{...statement,targets:[target]}]},new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:20000000})).events.map(event=>event.name)).toEqual(["value","x"]);
});
it("collects 10000 nested patterns without host recursion",()=>{
  const module=parseModule("match subject:\n case x:pass"),statement=module.body[0];if(statement.kind!=="match")throw Error("fixture");
  let pattern:Pattern=statement.cases[0].pattern;for(let i=0;i<10000;i++)pattern={kind:"sequence",items:[pattern],start:pattern.start,end:pattern.end};
  expect(collectSymbols({...module,body:[{...statement,cases:[{...statement.cases[0],pattern}]}]},new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:20000000})).events.map(event=>event.name)).toEqual(["subject","x"]);
});
it("meters defaultless parameters before creating their scope",()=>{
  const module=parseModule("def f(x):pass"),statement=module.body[0];if(statement.kind!=="function")throw Error("fixture");
  expect(()=>collectSymbols({...module,body:[{...statement,parameters:Array(10000).fill(statement.parameters[0])}]},new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("bounds symbol-event allocation",()=>{
  const module=parseModule("x");expect(()=>collectSymbols({...module,body:Array(10000).fill(module.body[0])},new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:1000}))).toThrow(ExecutionLimitError);
});
it("forwards the analysis meter to symbol collection",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),spy=vi.spyOn(symbols,"collectSymbols");
  try{analyzeModule("pass",{meter});expect(spy.mock.calls[0][1]).toBe(meter);}finally{spy.mockRestore();}
});
it("bounds cyclic statement bodies",()=>{
  const module=parseModule("def f():pass"),template=module.body[0];if(template.kind!=="function")throw Error("fixture");
  const body:Statement[]=[],cyclic={...template,body};body.push(cyclic);
  expect(()=>collectSymbols({...module,body},new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("bounds cyclic expression graphs",()=>{
  const module=parseModule("not x"),statement=module.body[0];if(statement.kind!=="expression-statement"||statement.expression.kind!=="unary")throw Error("fixture");
  const cyclic={...statement.expression};cyclic.operand=cyclic;
  expect(()=>collectSymbols({...module,body:[{...statement,expression:cyclic}]},new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});

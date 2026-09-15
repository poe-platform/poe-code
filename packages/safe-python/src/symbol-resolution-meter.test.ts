import {expect,it,vi} from "vitest";
import {parseModule} from "./module.js";
import {collectSymbols,type SymbolScope} from "./symbol-collection.js";
import {resolveSymbols} from "./symbol-resolution.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";
import {validateDeclarations} from "./declaration-validation.js";
import * as declarations from "./declaration-validation.js";

it("resolves 10000 nested scopes without host recursion",()=>{
  const root=collectSymbols(parseModule("def f():pass")),template=root.children[0];let child=template;
  for(let i=0;i<10000;i++)child={...template,children:[child]};
  expect(()=>resolveSymbols({...root,children:[child]},"<string>",new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:100000000}))).not.toThrow();
});
it("checks limits after declaration validation during binding construction",()=>{
  const scope=collectSymbols(parseModule("x")),controller=new AbortController(),original=validateDeclarations;
  const spy=vi.spyOn(declarations,"validateDeclarations").mockImplementation((...args)=>{original(...args);controller.abort();});
  try{expect(()=>resolveSymbols(scope,"<string>",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}))).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it("charges missing-nonlocal diagnostics before constructing them",()=>{
  const root=collectSymbols(parseModule("def f():nonlocal missing"));
  expect(()=>resolveSymbols(root,"<string>",{checkpoint(_steps=1,bytes=0){if(bytes>=256&&bytes<512)throw new ExecutionLimitError("allocation");}})).toThrow(ExecutionLimitError);
});
it("meters binding work after a budgeted declaration pass",()=>{
  const root=collectSymbols(parseModule("x"));
  // The reference call exposes declaration work without conflating it with
  // resolution; the budget below is deliberately only large enough for that pass.
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  validateDeclarations(root,"<string>",meter);
  expect(()=>resolveSymbols(root,"<string>",new ExecutionBudget({maxSteps:meter.usage.steps+1,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("bounds frame allocation after declaration validation",()=>{
  const root=collectSymbols(parseModule("x")),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});validateDeclarations(root,"<string>",meter);
  expect(()=>resolveSymbols(root,"<string>",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:meter.usage.allocatedBytes+128}))).toThrow(ExecutionLimitError);
});
it("propagates a free binding through a deep enclosing chain",()=>{
  const root=collectSymbols(parseModule("def outer(x):\n def empty():pass\n def leaf():return x")),outer=root.children[0],empty=outer.children[0];
  let nested=outer.children[1];for(let i=0;i<500;i++)nested={...empty,children:[nested]};
  const scope:SymbolScope={...root,children:[{...outer,children:[nested]}]};
  const result=resolveSymbols(scope,"<string>",new ExecutionBudget({maxSteps:10000000,maxAllocatedBytes:100000000}));
  expect(result.children[0].cells.has("x")).toBe(true);
  let child=result.children[0].children[0];while(child.children.length){expect(child.free.get("x")).toBe(result.children[0].scope);child=child.children[0];}
  expect(child.bindings.get("x")).toEqual({kind:"free",owner:result.children[0].scope});
});

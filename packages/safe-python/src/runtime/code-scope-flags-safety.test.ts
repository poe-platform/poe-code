import {expect,it,vi} from "vitest";
import {analyzeModule} from "../analysis.js";
import {compileCodeScopeFlags} from "./code-scope-flags.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

it("preserves cancellation when feature lookup throws",()=>{
  const root=analyzeModule("").scopes.scope,controller=new AbortController(),features=new Set<string>();
  features.has=()=>{controller.abort();throw new Error("feature lookup failed");};
  expect(()=>compileCodeScopeFlags(root,features,new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}))).toThrow(ExecutionLimitError);
});
it("checks cancellation after publishing the final scope flag",()=>{
  const root=analyzeModule("").scopes.scope,controller=new AbortController(),original=Map.prototype.set;
  const spy=vi.spyOn(Map.prototype,"set").mockImplementation(function(this:Map<unknown,unknown>,key,value){
    if(key===root)controller.abort();return original.call(this,key,value);
  });
  try{expect(()=>compileCodeScopeFlags(root,new Set(),new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}))).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it("reserves feature and traversal storage before lookup",()=>{
  const root=analyzeModule("").scopes.scope,features=new Set<string>(),lookup=vi.spyOn(features,"has");
  expect(()=>compileCodeScopeFlags(root,features,new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:128}))).toThrow(ExecutionLimitError);
  expect(lookup).not.toHaveBeenCalled();
});

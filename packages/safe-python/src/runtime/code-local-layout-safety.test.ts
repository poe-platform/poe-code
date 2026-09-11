import {expect,it,vi} from "vitest";
import {analyzeModule} from "../analysis.js";
import type {ResolvedScope} from "../symbol-resolution.js";
import {compileCodeLocalLayout} from "./code-local-layout.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

it("reserves 10000 nested inline scopes without host recursion",()=>{
  const fn=analyzeModule("def f():return [x for x in []]").scopes.children[0],template=fn.children[0];let child:ResolvedScope=template;
  for(let i=0;i<10000;i++)child={...template,scope:{...template.scope,children:[child.scope]},children:[child]};
  const scope={...fn,scope:{...fn.scope,children:[child.scope]},children:[child]};
  expect(compileCodeLocalLayout(scope,new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000})).variableNames).toEqual(["x"]);
});
it("meters private parameter mangling",()=>{
  const fn=analyzeModule("class C:\n def f(__x):pass").scopes.children[0].children[0];
  expect(()=>compileCodeLocalLayout({...fn,scope:{...fn.scope,privateName:"_".repeat(10000)+"C"}},new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("preserves cancellation immediately before layout publication",()=>{
  const scope=analyzeModule("def f():pass").scopes.children[0],controller=new AbortController(),original=Object.freeze;
  const spy=vi.spyOn(Object,"freeze").mockImplementation(value=>{
    if(value!==null&&typeof value==="object"&&"variableNames" in value)controller.abort();
    return original(value);
  });
  try{expect(()=>compileCodeLocalLayout(scope,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}))).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});
it("charges long local-name lookup work",()=>{
  const scope=analyzeModule("def f(): "+"x".repeat(10000)+"=1").scopes.children[0];
  expect(()=>compileCodeLocalLayout(scope,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
});

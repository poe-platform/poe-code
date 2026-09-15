import {expect,it,vi} from "vitest";
import {analyzeModule} from "./analysis.js";
import {collectQualifiedNames} from "./qualified-names.js";
import * as qualifiedNames from "./qualified-names.js";
import {manglePrivateName} from "./private-names.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["steps","allocation","cancelled"] as const)("checks qualified-name entry %s limits",reason=>{
  const root=analyzeModule("pass").scopes.scope,controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>collectQualifiedNames(root,meter)).toThrow(ExecutionLimitError);
});
it("bounds growing qualified-name strings before allocation",()=>{
  const root=analyzeModule("def f():pass").scopes.scope,child=root.children[0];let nested=child;
  for(let i=0;i<1000;i++)nested={...child,children:[nested]};
  expect(()=>collectQualifiedNames({...root,children:[nested]},new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000}))).toThrow(ExecutionLimitError);
});
it("meters duplicate global events before set lookup",()=>{
  const root=analyzeModule("global x").scopes.scope;
  expect(()=>collectQualifiedNames({...root,events:Array(10000).fill(root.events[0])},new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("forwards the analysis meter into qualified-name generation",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),spy=vi.spyOn(qualifiedNames,"collectQualifiedNames");
  try{analyzeModule("pass",{meter});expect(spy.mock.calls[0][1]).toBe(meter);}finally{spy.mockRestore();}
});
it("bounds private-name underscore scanning",()=>{
  expect(()=>manglePrivateName("__field","_".repeat(10000),new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("bounds mangled-name allocation",()=>{
  expect(()=>manglePrivateName("__field","Class".repeat(1000),new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000}))).toThrow(ExecutionLimitError);
});
it("visits siblings lazily rather than copying a wide scope tree",()=>{
  const root=analyzeModule("def f():pass").scopes.scope,children=Array(10000).fill(root.children[0]);
  Object.defineProperty(children,9999,{get(){throw Error("unvisited sibling");}});
  expect(()=>collectQualifiedNames({...root,children},new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("bounds cyclic external scope trees",()=>{
  const root=analyzeModule("pass").scopes.scope,children:typeof root[]=[],cyclic={...root,children};children.push(cyclic);
  expect(()=>collectQualifiedNames(cyclic,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("preserves cancellation even on private-name fast paths",()=>{
  const controller=new AbortController();controller.abort();
  expect(()=>manglePrivateName("ordinary",null,new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:1000,signal:controller.signal}))).toThrow(ExecutionLimitError);
});

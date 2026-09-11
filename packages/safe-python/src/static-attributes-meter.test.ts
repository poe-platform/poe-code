import {expect,it,vi} from "vitest";
import {analyzeModule} from "./analysis.js";
import {collectStaticAttributes} from "./static-attributes.js";
import * as staticAttributes from "./static-attributes.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["steps","allocation","cancelled"] as const)("checks static-attribute entry %s limits",reason=>{
  const root=analyzeModule("pass").scopes.scope,controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>collectStaticAttributes(root,meter)).toThrow(ExecutionLimitError);
});
it("bounds wide statement bodies without spreading them into host arguments",()=>{
  const root=analyzeModule("pass").scopes.scope;if(root.node.kind!=="module")throw Error("fixture");
  const node={...root.node,body:Array(200000).fill(root.node.body[0])};
  expect(()=>collectStaticAttributes({...root,node},new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("checks cancellation inside attribute-name sort comparisons",()=>{
  const root=analyzeModule("class C:\n def f(self):\n  self.z=1\n  self.a=2").scopes.scope;
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),original=Array.prototype.sort;let comparisons=0;
  const spy=vi.spyOn(Array.prototype,"sort").mockImplementation(function(this:unknown[],compare){controller.abort();return original.call(this,(a,b)=>{comparisons++;return compare!(a,b);});});
  try{expect(()=>collectStaticAttributes(root,meter)).toThrow(ExecutionLimitError);expect(comparisons).toBe(1);}finally{spy.mockRestore();}
});
it("forwards the analysis meter to static-attribute collection",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),spy=vi.spyOn(staticAttributes,"collectStaticAttributes");
  try{analyzeModule("pass",{meter});expect(spy.mock.calls[0][1]).toBe(meter);}finally{spy.mockRestore();}
});
it("processes a wide body within a sufficient budget without host argument limits",()=>{
  const root=analyzeModule("pass").scopes.scope;if(root.node.kind!=="module")throw Error("fixture");
  expect(collectStaticAttributes({...root,node:{...root.node,body:Array(200000).fill(root.node.body[0])}},new ExecutionBudget({maxSteps:2000000,maxAllocatedBytes:50000000})).size).toBe(0);
});
it("bounds cyclic external scope trees",()=>{
  const root=analyzeModule("pass").scopes.scope,children:typeof root[]=[],cyclic={...root,children};children.push(cyclic);
  expect(()=>collectStaticAttributes(cyclic,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
});
it("bounds pending statement storage before allocation",()=>{
  const root=analyzeModule("pass").scopes.scope;if(root.node.kind!=="module")throw Error("fixture");
  expect(()=>collectStaticAttributes({...root,node:{...root.node,body:Array(10000).fill(root.node.body[0])}},new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000}))).toThrow(ExecutionLimitError);
});

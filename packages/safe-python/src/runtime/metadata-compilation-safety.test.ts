import {expect,it,vi} from "vitest";
import {analyzeModule} from "../analysis.js";
import {compileFunction} from "./function-compilation.js";
import {compileClassBody} from "./class-compilation.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

const source={filename:"test.py"},options={stripDocstring:true};
it.each([
  ["function","string",1],["function","string",2],["function","integer",1],
  ["class","string",1],["class","string",2],["class","integer",1],["class","tuple",1]
] as const)("preserves cancellation from throwing %s %s factory call %s",(kind,method,call)=>{
  const analysis=analyzeModule(kind==="function"?"def f():pass":"class C:\n def f(self):self.a=1");
  const controller=new AbortController();let calls=0;
  const factory=(name:string)=>()=>{if(name===method&&++calls===call){controller.abort();throw new Error("factory failure");}return "constant";};
  const constants={string:factory("string"),integer:factory("integer"),tuple:factory("tuple")};
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  expect(()=>kind==="function"?compileFunction(analysis.scopes.children[0],analysis,options,constants,meter,source,0):
    compileClassBody(analysis.scopes.children[0],analysis,options,constants,meter,source,0)).toThrow(ExecutionLimitError);
});
it.each(["function","class"] as const)("reserves %s metadata before invoking constant factories",kind=>{
  const analysis=analyzeModule(kind==="function"?"def f():pass":"class C:pass"),factory=vi.fn(()=>"constant");
  const constants={string:factory,integer:factory,tuple:factory},meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:32});
  expect(()=>kind==="function"?compileFunction(analysis.scopes.children[0],analysis,options,constants,meter,source,0):
    compileClassBody(analysis.scopes.children[0],analysis,options,constants,meter,source,0)).toThrow(ExecutionLimitError);
  expect(factory).not.toHaveBeenCalled();
});
it("charges class static-attribute array slots",()=>{
  const analysis=analyzeModule("class C:pass"),scope=analysis.scopes.children[0];
  const metadata={...analysis,staticAttributes:new Map([[scope.scope,Array.from({length:1000},()=>"a")]])};
  expect(()=>compileClassBody(scope,metadata,options,{string:()=>"",integer:()=>"",tuple:()=>""},
    new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000}),source,0)).toThrow(ExecutionLimitError);
});
it("preserves cancellation from a lambda metadata factory",()=>{
  const analysis=analyzeModule("f=lambda:1"),controller=new AbortController();
  expect(()=>compileFunction(analysis.scopes.children[0],analysis,options,
    {string:()=>{controller.abort();throw new Error("factory failure");},integer:()=>""},
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),source,0)).toThrow(ExecutionLimitError);
});
it("preserves undefined constant values in lambda metadata",()=>{
  const analysis=analyzeModule("f=lambda:1");
  const result=compileFunction(analysis.scopes.children[0],analysis,options,{string:()=>undefined,integer:()=>undefined},
    new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),{filename:undefined},0);
  expect(result).toMatchObject({name:undefined,qualifiedName:undefined,firstLine:undefined,body:{kind:"expression"}});
});

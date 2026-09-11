import {expect,it,vi} from "vitest";
import {analyzeModule} from "../analysis.js";
import {parseExpression} from "../expression.js";
import {comprehensionIsAsynchronous} from "./comprehension-asynchronous.js";
import {compileGeneratorExpression} from "./generator-expression-compilation.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

it("meters defaultless lambda parameter scans during async classification",()=>{
  const root=parseExpression("((lambda x:0) for x in [])");
  if(root.kind!=="comprehension"||root.element.kind!=="lambda")throw Error("expected lambda comprehension");
  const parameter=root.element.parameters[0];
  const element={...root.element,parameters:Array.from({length:10000},()=>parameter)};
  expect(()=>comprehensionIsAsynchronous({...root,element},new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
});
it("meters literal interpolation parts during async classification",()=>{
  const root=parseExpression('(f"text" for x in [])');
  if(root.kind!=="comprehension"||root.element.kind!=="interpolated-string")throw Error("expected formatted comprehension");
  const part=root.element.parts[0],element={...root.element,parts:Array.from({length:10000},()=>part)};
  expect(()=>comprehensionIsAsynchronous({...root,element},new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
});
it("preserves cancellation at an early async-clause result",()=>{
  const root=parseExpression("(x for x in [])"),controller=new AbortController();
  if(root.kind!=="comprehension")throw Error("expected comprehension");
  const clause={...root.clauses[0],get async(){controller.abort();return true;}};
  expect(()=>comprehensionIsAsynchronous({...root,clauses:[clause]},new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal}))).toThrow(ExecutionLimitError);
});
it("preserves cancellation while freezing generator metadata",()=>{
  const analysis=analyzeModule("(x for x in [])"),controller=new AbortController(),original=Object.freeze;
  const spy=vi.spyOn(Object,"freeze").mockImplementation(value=>{
    if(value!==null&&typeof value==="object"&&"qualifiedName" in value&&"localLayout" in value)controller.abort();
    return original(value);
  });
  try{expect(()=>compileGeneratorExpression(analysis.scopes.children[0],analysis,{filename:"test.py"},3,
    {string:()=>"",integer:()=>""},new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}))).toThrow(ExecutionLimitError);}finally{spy.mockRestore();}
});

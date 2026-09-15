import {expect,it} from "vitest";
import {parseExpression} from "./expression.js";
import {validateExpression} from "./expression-validation.js";
import type {Expression,InterpolatedPart} from "./ast.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["steps","allocation","cancelled"] as const)("checks validation entry %s limits",reason=>{
  const node=parseExpression("x"),controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>validateExpression(node,"<string>",undefined,meter)).toThrow(ExecutionLimitError);
});
it("charges wide expression child enumeration before allocating its entire work stack",()=>{
  const leaf=parseExpression("x"),node:Expression={kind:"list",items:Array<Expression>(10000).fill(leaf),start:leaf.start,end:leaf.end};
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:10000});
  expect(()=>validateExpression(node,"<string>",undefined,meter)).toThrow(ExecutionLimitError);
});
it("charges lambda parameters even when none has a default expression",()=>{
  const node=parseExpression("lambda x:x");if(node.kind!=="lambda")throw Error("expected lambda");
  const wide={...node,parameters:Array(10000).fill(node.parameters[0])};
  expect(()=>validateExpression(wide,"<string>",undefined,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:10000}))).toThrow(ExecutionLimitError);
});
it("meters comprehension bindings and scope-set work",()=>{
  const node=parseExpression("[x for x in xs for y in ys if x if y]");
  expect(()=>validateExpression(node,"<string>",undefined,new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100}))).toThrow(ExecutionLimitError);
});
it("charges syntax diagnostic allocation before constructing the error",()=>{
  const node=parseExpression("(yield 1)"),context={iterations:new Set<string>(),iterable:false,target:false,assignments:null,comprehension:"list comprehension"};
  expect(()=>validateExpression(node,"<string>",context,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:160}))).toThrow(ExecutionLimitError);
});
it("retains successful expression validation with an ordinary budget",()=>{
  const node=parseExpression("[(lambda y:y)(x) for x in xs if x]"),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
  expect(()=>validateExpression(node,"<string>",undefined,meter)).not.toThrow();
  expect(meter.usage.steps).toBeGreaterThan(0);expect(meter.usage.allocatedBytes).toBeGreaterThan(0);
});
it("walks deeply nested format specifications without using the host stack",()=>{
  const base=parseExpression('f"{x}"');if(base.kind!=="interpolated-string"||base.parts[0].kind!=="field")throw Error("expected field");
  let parts:readonly InterpolatedPart[]=base.parts;
  for(let index=0;index<10000;index++)parts=[{...base.parts[0],format:parts}];
  expect(()=>validateExpression({...base,parts},"<string>",undefined,new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000}))).not.toThrow();
});
it("meters literal format parts that produce no expression children",()=>{
  const base=parseExpression('f"text"');if(base.kind!=="interpolated-string")throw Error("expected string");
  const node={...base,parts:Array<InterpolatedPart>(10000).fill(base.parts[0])};
  expect(()=>validateExpression(node,"<string>",undefined,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
});
it("meters empty slice entries that produce no expression children",()=>{
  const base=parseExpression("x[:]");if(base.kind!=="subscript")throw Error("expected subscript");
  const node={...base,items:Array(10000).fill(base.items[0])};
  expect(()=>validateExpression(node,"<string>",undefined,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
});
it("bounds cyclic externally supplied format trees with the same meter",()=>{
  const base=parseExpression('f"{x}"');if(base.kind!=="interpolated-string"||base.parts[0].kind!=="field")throw Error("expected field");
  const parts:InterpolatedPart[]=[];parts.push({...base.parts[0],format:parts});
  expect(()=>validateExpression({...base,parts},"<string>",undefined,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
});

import {expect,it} from "vitest";
import {annotationTargetExpressions} from "./annotation-targets.js";
import {parseExpression} from "./expression.js";
import type {SubscriptItem} from "./ast.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it("checks allocation limits before annotation traversal",()=>{
  expect(()=>[...annotationTargetExpressions(parseExpression("obj.key"),"<string>",new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:0}))]).toThrow(ExecutionLimitError);
});
it("bounds nested tuple-frame allocation",()=>{
  const target=parseExpression("obj[key]");if(target.kind!=="subscript")throw Error("fixture");
  let item:SubscriptItem=target.items[0];for(let i=0;i<10000;i++)item={kind:"tuple",items:[item],start:target.start,end:target.end};
  expect(()=>[...annotationTargetExpressions({...target,items:[item]},"<string>",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000}))]).toThrow(ExecutionLimitError);
});
it("charges starred-target diagnostics before constructing them",()=>{
  const target=parseExpression("obj[*keys]");
  expect(()=>[...annotationTargetExpressions(target,"<string>",{checkpoint(_steps=1,bytes=0){if(bytes>=256)throw new ExecutionLimitError("allocation");}})]).toThrow(ExecutionLimitError);
});
it.each(["return","throw"] as const)("preserves cancellation when a consumer invokes %s",operation=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:100000,signal:controller.signal});
  const iterator=annotationTargetExpressions(parseExpression("obj[key]"),"<string>",meter);iterator.next();controller.abort();
  expect(()=>operation==="return"?iterator.return(undefined):iterator.throw(new Error("consumer failure"))).toThrow(ExecutionLimitError);
});
it("traverses deep tuple keys without host recursion",()=>{
  const target=parseExpression("obj[key]");if(target.kind!=="subscript")throw Error("fixture");
  const key=target.items[0];let item:SubscriptItem=key;for(let i=0;i<10000;i++)item={kind:"tuple",items:[item],start:target.start,end:target.end};
  expect([...annotationTargetExpressions({...target,items:[item]},"<string>",new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:10000000}))]).toEqual([target.object,key]);
});
it("preserves flattened key and slice-bound order",()=>{
  const source="obj[(first, (second, third)), lower:upper:step, last]";
  expect([...annotationTargetExpressions(parseExpression(source),"<string>",new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}))].map(node=>source.slice(node.start.offset,node.end.offset))).toEqual(["obj","first","second","third","lower","upper","step","last"]);
});

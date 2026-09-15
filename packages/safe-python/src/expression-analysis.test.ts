import {expect,it} from "vitest";
import {analyzeExpression,PythonSyntaxError} from "./index.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it("retains expression identity through the module analysis root",()=>{
  const result=analyzeExpression("lambda x: lambda: x + missing");
  expect(result.module.body[0]).toMatchObject({kind:"expression-statement",expression:result.expression});
  expect(result.scopes.scope.node).toBe(result.module);
  const outer=result.scopes.children[0],inner=outer.children[0];
  expect(outer.scope.node).toBe(result.expression);
  expect(inner.bindings.get("x")).toEqual({kind:"free",owner:outer.scope});
  expect(inner.bindings.get("missing")).toEqual({kind:"global",owner:result.scopes.scope});
  expect([...result.qualifiedNames.values()]).toContain("<lambda>.<locals>.<lambda>");
});
it.each(["(yield 1)","await x","[x async for x in xs]","[(x:=1) for x in xs]","[x for x in (y:=xs)]","x=1","return 1"])("rejects invalid evaluation context: %s",source=>{
  expect(()=>analyzeExpression(source,{filename:"expression.py"})).toThrow(PythonSyntaxError);
  try{analyzeExpression(source,{filename:"expression.py"});}catch(error){expect(error).toMatchObject({filename:"expression.py",sourceLine:expect.any(String)});}
});
it("classifies lambda generators and asynchronous generator expressions",()=>{
  const result=analyzeExpression("(lambda: (yield 1), (x async for x in xs))");
  expect([...result.functionKinds.values()]).toContain("generator");
  expect(result.scopes.children.map(scope=>scope.scope.kind)).toEqual(["lambda","comprehension"]);
});
it("resolves comprehension assignment expressions in the evaluation namespace",()=>{
  const result=analyzeExpression("[(y:=x) for x in xs]");
  expect(result.scopes.bindings.has("y")).toBe(true);
  expect(result.scopes.children[0].bindings.get("y")).toEqual({kind:"global",owner:result.scopes.scope});
});
it("enforces allocation limits before producing analysis",()=>{
  expect(()=>analyzeExpression("1",{meter:new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:0})})).toThrow(ExecutionLimitError);
});
it("restores expression recursion state when analysis fails",()=>{
  let depth=0;
  expect(()=>analyzeExpression("await (lambda: 1)",{enterRecursiveCall(){depth++;return ()=>{depth--;};}})).toThrow(PythonSyntaxError);
  expect(depth).toBe(0);
});

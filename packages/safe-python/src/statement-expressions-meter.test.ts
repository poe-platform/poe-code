import {expect,it,vi} from "vitest";
import {parseModule} from "./module.js";
import {statementExpressions} from "./statement-expressions.js";
import * as statements from "./statement-expressions.js";
import type {Statement} from "./statement-ast.js";
import {ExecutionBudget,ExecutionLimitError} from "./runtime/execution-budget.js";

it.each(["steps","allocation","cancelled"] as const)("checks statement traversal %s limits",reason=>{
  const statement=parseModule("pass").body[0],controller=new AbortController();if(reason==="cancelled")controller.abort();
  const meter=new ExecutionBudget({maxSteps:reason==="steps"?0:10000,maxAllocatedBytes:reason==="allocation"?0:100000,signal:controller.signal});
  expect(()=>[...statementExpressions(statement,true,meter)]).toThrow(ExecutionLimitError);
});
it("traverses 10000 nested statements without host recursion",()=>{
  const template=parseModule("def f():pass").body[0];if(template.kind!=="function")throw Error("fixture");
  let statement:Statement=parseModule("x").body[0];for(let i=0;i<10000;i++)statement={...template,body:[statement]};
  expect([...statementExpressions(statement,true,new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000}))]).toHaveLength(1);
});
it("bounds a wide body of expressionless statements",()=>{
  const statement=parseModule("def f():pass").body[0];if(statement.kind!=="function")throw Error("fixture");
  expect(()=>[...statementExpressions({...statement,body:Array(10000).fill(statement.body[0])},true,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))]).toThrow(ExecutionLimitError);
});
it("meters parameters without defaults",()=>{
  const statement=parseModule("def f(x):pass").body[0];if(statement.kind!=="function")throw Error("fixture");
  expect(()=>[...statementExpressions({...statement,parameters:Array(10000).fill(statement.parameters[0])},false,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))]).toThrow(ExecutionLimitError);
});
it("forwards the module parser meter into expression enumeration",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),spy=vi.spyOn(statements,"statementExpressions");
  try{parseModule("pass",{meter});expect(spy.mock.calls[0][2]).toBe(meter);}finally{spy.mockRestore();}
});
it.each([
  ["@decorator\ndef f(a=default):\n result",["decorator","default","result"]],
  ["@decorator\nclass C(base, key=value):\n result",["decorator","base","value","result"]],
  ["with context as target, other:\n result",["context","target","other","result"]],
  ["try:\n body\nexcept error:\n handler\nelse:\n other\nfinally:\n final",["body","error","handler","other","final"]],
  ["for target in source:\n body\nelse:\n other",["target","source","body","other"]],
  ["if first:\n one\nelif second:\n two\nelse:\n three",["first","one","second","two","three"]],
  ["while condition:\n body\nelse:\n other",["condition","body","other"]],
  ["target = value",["value","target"]],
  ["target: ignored = value",["value","target"]],
  ["target += value",["target","value"]],
  ["raise error from cause",["error","cause"]],
  ["assert condition, message",["condition","message"]],
  ["match subject:\n case {'key': C(ns.value, key=True)} as capture if guard:\n  body",["subject","'key'","C","ns.value","True","guard","body"]],
  ["match subject:\n case [1, *rest] | [2, *rest]:\n  body",["subject","1","2","body"]]
] as const)("preserves executable expression order in %s",(source,expected)=>{
  const statement=parseModule(source).body[0],meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  expect([...statementExpressions(statement,true,meter)].map(expression=>source.slice(expression.start.offset,expression.end.offset))).toEqual(expected);
});
it("does not enter nested bodies when descent is disabled",()=>{
  const statement=parseModule("if condition:\n body\nelse:\n other").body[0];
  expect([...statementExpressions(statement,false)].map(expression=>expression.kind)).toEqual(["name"]);
});
it("checks cancellation when a consumer closes a suspended traversal",()=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:100000,signal:controller.signal});
  const iterator=statementExpressions(parseModule("x").body[0],true,meter);iterator.next();controller.abort();
  expect(()=>iterator.return(undefined)).toThrow(ExecutionLimitError);
});
it("bounds cyclic external statement bodies",()=>{
  const template=parseModule("def f():pass").body[0];if(template.kind!=="function")throw Error("fixture");
  const body:Statement[]=[],statement={...template,body};body.push(statement);
  expect(()=>[...statementExpressions(statement,true,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000000}))]).toThrow(ExecutionLimitError);
});

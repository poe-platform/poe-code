import {expect,it} from "vitest";
import {parseModule} from "../module.js";
import type {Statement} from "../statement-ast.js";
import {eliminateAssertions} from "./assertion-elimination.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
const budget=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:50000000});
it("removes assertions from compound suites without changing definition identities",()=>{
  const body=parseModule('assert x\nif x:\n assert x\nelse:\n assert x\nwhile x:\n assert x\nelse:\n assert x\nfor x in y:\n assert x\nelse:\n assert x\nwith x:\n assert x\ntry:\n assert x\nexcept:\n assert x\nelse:\n assert x\nfinally:\n assert x\nmatch x:\n case _:\n  assert x\ndef f():assert x\nclass C:assert x\n').body;
  const output=eliminateAssertions(body,budget());
  expect(output).toHaveLength(body.length-1);
  expect(output.at(-1)).toBe(body.at(-1));expect(output.at(-2)).toBe(body.at(-2));
  expect(output.slice(0,-2)).toMatchObject([{branches:[{body:[]}],otherwise:[]},{body:[],otherwise:[]},{body:[],otherwise:[]},{body:[]},{body:[],handlers:[{body:[]}],otherwise:[],finalizer:[]},{cases:[{body:[]}]}]);
  expect(body[0].kind).toBe("assert");expect(body[1]).toMatchObject({branches:[{body:[{kind:"assert"}]}]});
});
it("handles deeply nested supplied ASTs without host recursion",()=>{
  const initial=parseModule('if x:assert x').body[0];if(initial.kind!=="if")throw Error("expected if");
  let body:readonly Statement[]=initial.branches[0].body;
  for(let i=0;i<20000;i++)body=[{...initial,branches:[{condition:initial.branches[0].condition,body}]}];
  let output=eliminateAssertions(body,budget());
  for(let i=0;i<20000;i++){const statement=output[0];if(statement.kind!=="if")throw Error("expected if");output=statement.branches[0].body;}
  expect(output).toEqual([]);
});
it("enforces allocation limits before producing rewritten suites",()=>{
  expect(()=>eliminateAssertions(parseModule('if x:assert x').body,new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0}))).toThrow(ExecutionLimitError);
});

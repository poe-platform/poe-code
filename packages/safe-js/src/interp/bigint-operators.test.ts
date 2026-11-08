import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { bigIntOperation } from "./bigint-operators.js";

it.each(["+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>"])("matches native arithmetic and compound assignment for %s", async operator => {
  const source=`const results=[];for(const a of [-9n,0n,7n])for(const b of [-2n,0n,3n]){try{let x=a;const direct=a ${operator} b;x ${operator}= b;results.push([direct,x])}catch(error){results.push(error.name)}}return results;`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it.each(["<", "<=", ">", ">=", "==", "!=", "===", "!=="])("matches native exact comparisons for %s", async operator => {
  const source=`const result=[];for(const a of [-1n,0n,1n,9007199254740993n])for(const b of [null,undefined,true,false,-1,0,1,1.5,Infinity,NaN,'1','1.5','invalid','9007199254740993'])result.push(a ${operator} b,b ${operator} a);return result;`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("meters constant-result exponentiation operands", () => {
  expect(()=>bigIntOperation("**",1n,10n**100n,new Budget({maxSteps:1})))
    .toThrowError(expect.objectContaining({code:"budgetExceeded",budget:"steps"}));
});

it.each(["steps", "dataSize"])("rejects large operations before allocation using %s", kind => {
  const budget=new Budget(kind === "steps" ? {maxSteps:20} : {dataSize:20});
  const before=budget.currentDataSize;
  expect(()=>bigIntOperation("<<",1n,1000000000n,budget))
    .toThrowError(expect.objectContaining({code:"budgetExceeded",budget:kind}));
  expect(budget.currentDataSize).toBe(before);
});

it("does not allow guest code to catch arithmetic resource exhaustion", async () => {
  await expect(run("try{return 2n**1000000000n}catch(error){return 'caught'}",{budget:new Budget({dataSize:1000})}))
    .rejects.toMatchObject({code:"budgetExceeded"});
});

import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createBuiltinBindings } from "../globals.js";
import { getSandboxPropertyDescriptor } from "../object-model.js";
import { createSandboxClosure, isSandboxClosure } from "../values.js";

it.each([0,1,2])("allows exactly %s output elements", async count => {
  const source=count === 0 ? "function* values(){}return values().toArray()"
    : `let index=0;return Iterator.from({next(){return {value:++index,done:index>${count}}}}).toArray()`;
  expect(await run(source,
    {budget:new Budget({arrayLength:count})})).toMatchObject({ok:true,returnValue:Array.from({length:count},(_,index)=>index+1)});
});

it("rejects an output above the limit without executing guest cleanup", async () => {
  let closed=0;
  const source=`let index=0;return Iterator.from({next(){return {value:++index,done:index>2}},
    return(){closed();return {done:true}}}).toArray()`;
  await expect(run(source,{budget:new Budget({arrayLength:1}),bindings:{closed:()=>{closed++;}}}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength",current:2,limit:1});
  expect(closed).toBe(0);
});

it("enforces the same output limit for a direct SDK consumer call", async () => {
  const budget=new Budget({arrayLength:1});
  const bindings=createBuiltinBindings({budget});
  const prototype=getSandboxPropertyDescriptor(bindings.Iterator,"prototype",budget)?.value;
  const consume=getSandboxPropertyDescriptor(prototype,"toArray",budget)?.value;
  if (!isSandboxClosure(consume)) throw new Error("Missing iterator consumer");
  let calls=0,closed=0;
  const receiver={
    next:createSandboxClosure({guest:true,sandbox:true,call:()=>({value:++calls,done:calls>2})}),
    return:createSandboxClosure({guest:true,sandbox:true,call:()=>{closed++;return {done:true};}})
  };
  await expect(consume.call([],{stack:[],thisValue:receiver})).rejects
    .toMatchObject({code:"budgetExceeded",budget:"arrayLength",current:2,limit:1});
  expect(calls).toBe(2);
  expect(closed).toBe(0);
});

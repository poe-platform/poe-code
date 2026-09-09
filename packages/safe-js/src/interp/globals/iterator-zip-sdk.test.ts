import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createBuiltinBindings } from "../globals.js";
import { getSandboxPropertyDescriptor } from "../object-model.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "../values.js";

it.each(["zip", "zipKeyed"])("preserves %s SDK helper and row realms with foreign Proxy inputs", async method => {
  const exports=(await run(`return [Iterator.${method},Array.prototype,Object.prototype,
    Object.getPrototypeOf([].values().map(x=>x))]`)).returnValue;
  const inputs=(await run(`return new Proxy(${method === "zip" ? "[[3],[4]]" : "{a:[3],b:[4]}"},{})`)).returnValue;
  const getter=(await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exports) || !isSandboxClosure(exports[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context={stack:[],thisValue:undefined};
  const helper=await exports[0].call([inputs],context);
  expect(await getter.call([helper],context)).toBe(exports[3]);
  const next=getSandboxPropertyDescriptor(helper,"next")?.value;
  if (!isSandboxClosure(next)) throw new Error("Expected next method");
  const result=await next.call([],{stack:[],thisValue:helper});
  expect(await getter.call([result],context)).toBe(exports[2]);
  const row=getSandboxPropertyDescriptor(result,"value")?.value;
  expect(await getter.call([row],context)).toBe(method === "zip" ? exports[1] : null);
  const done=await next.call([],{stack:[],thisValue:helper});
  expect(await getter.call([done],context)).toBe(exports[2]);
});

it("does not call guest cleanup after a fatal step budget failure", async () => {
  const budget=new Budget({maxSteps:10000});
  const bindings=createBuiltinBindings({budget});
  const zip=getSandboxPropertyDescriptor(bindings.Iterator,"zip",budget)?.value;
  if (!isSandboxClosure(zip)) throw new Error("Expected zip method");
  let closed=0;
  const input={
    next:createSandboxClosure({guest:true,sandbox:true,call:()=>{budget.visitNode(10001);return {done:false,value:1};}}),
    return:createSandboxClosure({guest:true,sandbox:true,call:()=>{closed++;return {done:true};}})
  };
  const helper=await zip.call([[input,input]],{stack:[],thisValue:undefined});
  const next=getSandboxPropertyDescriptor(helper,"next",budget)?.value;
  if (!isSandboxClosure(next)) throw new Error("Expected next method");
  await expect(next.call([],{stack:[],thisValue:helper})).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  expect(closed).toBe(0);
});

it("enforces the array-length budget on zip rows, not just input arrays", async () => {
  const source=`const inputs={[Symbol.iterator]:function*(){yield [1];yield [2]}};
    return Iterator.zip(inputs).next()`;
  await expect(run(source,{budget:new Budget({arrayLength:1})})).rejects
    .toMatchObject({code:"budgetExceeded",budget:"arrayLength",current:2,limit:1});
});

it("keeps the zip row realm when next is borrowed from another realm", async () => {
  const original=(await run("return [Iterator.zip([[1],[2]]),Array.prototype]")).returnValue;
  const foreign=(await run("return [[].values().map(x=>x).next,Object.prototype,Object.getPrototypeOf]")).returnValue;
  if (!Array.isArray(original) || !Array.isArray(foreign) || !isSandboxClosure(foreign[0]) || !isSandboxClosure(foreign[2]))
    throw new Error("Expected SDK exports");
  const result=await foreign[0].call([],{stack:[],thisValue:original[0]});
  const row=getSandboxPropertyDescriptor(result,"value")?.value;
  expect(await foreign[2].call([result],{stack:[],thisValue:undefined})).toBe(foreign[1]);
  expect(await foreign[2].call([row],{stack:[],thisValue:undefined})).toBe(original[1]);
});

it("retains the first close error while subsequent close methods run", async () => {
  const measurements=[];
  for (const length of [0,200]) {
    const budget=new Budget();
    const bindings=createBuiltinBindings({budget});
    const zip=getSandboxPropertyDescriptor(bindings.Iterator,"zip",budget)?.value;
    if (!isSandboxClosure(zip)) throw new Error("Expected zip method");
    const next=createSandboxClosure({guest:true,sandbox:true,call:()=>({done:false,value:1})});
    const first={next,return:createSandboxClosure({guest:true,sandbox:true,call:()=>{
      measurements.push(measureSandboxData([...budget.retainedValues()]));
      return {done:true};
    }})};
    const last={next,return:createSandboxClosure({guest:true,sandbox:true,call:()=>{throw {payload:"x".repeat(length)};}})};
    const helper=await zip.call([[first,last]],{stack:[],thisValue:undefined});
    const close=getSandboxPropertyDescriptor(helper,"return",budget)?.value;
    if (!isSandboxClosure(close)) throw new Error("Expected return method");
    await expect(close.call([],{stack:[],thisValue:helper})).rejects.toMatchObject({payload:"x".repeat(length)});
  }
  expect(measurements[1]-measurements[0]).toBe(200);
});

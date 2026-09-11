import { runInNewContext } from "node:vm";
import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { Budget } from "./budget.js";
import { acquireSandboxIterator } from "./iteration.js";
import { getSandboxDataProperty } from "./object-model.js";

const receivers = [
  ["primitive string", "String", "'a😀b'"],
  ["boxed string", "String", "new String('a😀b')"],
  ["Set", "Set", "new Set([2,4])"],
  ["Map", "Map", "new Map([[2,4]])"]
] as const;
const consumers = [
  "return [...value]",
  "const result=[];for(const entry of value)result.push(entry);return result",
  "const result=[];for await(const entry of value)result.push(entry);return result",
  "return Array.from(value)",
  "return await Array.fromAsync(value)"
] as const;

it.each(receivers.flatMap(([name, constructor, input]) => consumers.flatMap(consumer =>
  ["delete", "undefined", "null"].map(mutation => ({name, constructor, input, consumer, mutation}))
)))("honors $mutation iterator on $name: $consumer", async ({constructor, input, consumer, mutation}) => {
  const target=constructor+".prototype[Symbol.iterator]";
  const source="const value="+input+";"+(mutation==='delete'?"delete "+target:target+"="+mutation)+";try{"+consumer+"}catch(error){return error.name}";
  // Prototype edits must never affect the host realm used by the interpreter.
  const expected=await runInNewContext("(async()=>{"+source+"})()");
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it("keeps legacy implicit strings when no guest prototype was installed", async () => {
  const budget=new Budget();
  const iterator=await acquireSandboxIterator('a😀',budget,{stack:[],thisValue:undefined,
    getProperty:(value,key)=>getSandboxDataProperty(value,key,budget)});
  assert(iterator);
  expect(await iterator.next()).toEqual({value:'a',done:false});
  expect(await iterator.next()).toEqual({value:'😀',done:false});
  expect(await iterator.next()).toEqual({value:undefined,done:true});
});

it("preserves a deleted iterator through public replay", async () => {
  const source="delete String.prototype[Symbol.iterator];await 0;return [Array.from('a😀b'),await Array.fromAsync('a😀b')]";
  const expected=await runInNewContext("(async()=>{"+source+"})()");
  const first=await run(source);
  assert(first.ok);
  expect(first.returnValue).toEqual(expected);
  const replay=await run(source,{snapshot:JSON.parse(await dump(first))});
  assert(replay.ok);
  expect(replay.returnValue).toEqual(expected);
});

it.each([
  "'ab'[Symbol.iterator]()",
  "[2,4].values()"
])("does not resurrect a removed iterator identity method: %s", async input => {
  const source="const value="+input+";delete Object.getPrototypeOf(Object.getPrototypeOf(value))[Symbol.iterator];try{return [...value]}catch(error){return error.name}";
  const expected=runInNewContext("(()=>{"+source+"})()");
  expect(expected).toBe('TypeError');
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toBe(expected);
});

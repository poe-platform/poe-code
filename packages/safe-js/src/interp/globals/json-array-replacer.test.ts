import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createConsoleJsonGlobals } from "./console-json.js";
import { isSandboxClosure } from "../values.js";

it.each(["steps", "dataSize", "arrayLength", "stringLength"])("bounds property lists by %s and releases temporary storage", async kind => {
  const budget = new Budget(kind === "steps" ? {maxSteps:1} : kind === "dataSize" ? {dataSize:1} : kind === "arrayLength" ? {arrayLength:1} : {stringLength:1});
  const stringify = createConsoleJsonGlobals({budget}).JSON.stringify;
  if (!isSandboxClosure(stringify)) throw new Error('Missing stringify');
  const before = budget.currentDataSize;
  await expect(stringify.call([{},kind === "stringLength" ? ['long'] : ['a','b']]))
    .rejects.toMatchObject({code:'budgetExceeded',budget:kind});
  expect(budget.currentDataSize).toBe(before);
});

it.each([
  "return JSON.stringify({a:1,b:2,c:3},['b','a','b']);",
  "return JSON.stringify({a:{a:1,b:2},b:3},['a']);",
  "return JSON.stringify([{a:1,b:2},3],['a']);",
  "return JSON.stringify({0:'zero',1:'one',a:2},[1,'a',0,1]);",
  "return JSON.stringify({a:1,b:2},[new String('b'),new String('a'),true,null,{},Symbol(),1n]);",
  "const value=Object.create({a:1});Object.defineProperty(value,'b',{value:2});return JSON.stringify(value,['b','a']);",
  "const calls=[];const keys=['b','a'];Object.defineProperty(keys,'0',{get(){calls.push('key');return 'b'}});const value={get a(){calls.push('a');return 1},get b(){calls.push('b');return 2}};const json=JSON.stringify(value,keys);return [json,calls];",
  "const keys=['a','b'];const value={toJSON(){keys[0]='b';return {a:1,b:2}}};return JSON.stringify(value,keys);",
  "return JSON.stringify({a:1},[]);",
  "const keys=['a','b'];Object.defineProperty(keys,'0',{get(){keys.push('c');return 'a'}});return JSON.stringify({a:1,b:2,c:3},keys);",
  "const keys=['a','b'];Object.defineProperty(keys,'0',{get(){keys[1]='c';return 'a'}});return JSON.stringify({a:1,b:2,c:3},keys);",
  "const key=new Number(1);key.toString=()=> 'a';return JSON.stringify({a:1,1:2},[key,new Number(1)]);",
  "const keys=['a'];keys[Symbol.iterator]=()=>{throw new Error('iterator')};return JSON.stringify({a:1},keys);",
  "const key=new String('a');key.toString=()=>{throw new RangeError('key')};try{return JSON.stringify({a:1},[key])}catch(error){return [error.name,error.message]}",
  "return [JSON.stringify({a:1},true),JSON.stringify({a:1},1),JSON.stringify({a:1},{}),JSON.stringify({a:1},Symbol())];"
])("matches native property-list replacers: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function('"use strict";'+source)()});
});

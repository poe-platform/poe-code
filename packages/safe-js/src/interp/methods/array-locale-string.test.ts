import { expect, it } from "vitest";
import { run } from "../../run.js";
import { runInNewContext } from "node:vm";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  "return [Array.isArray(Array.prototype),Array.prototype.length,Object.getPrototypeOf([])===Array.prototype,Object.getPrototypeOf(Array.prototype)===Object.prototype,Array.prototype.constructor===Array];",
  "return [{}.toString.call([]),[].toString(),[1,2].toString(),[].map===[].map,[].map===Array.prototype.map];",
  "Array.prototype.map=function(){return 'replacement'};return [1].map();",
  "delete Array.prototype.map;return [typeof [].map,'map' in []];",
  "Object.defineProperty(Array.prototype,'toLocaleString',{get(){return function(){return this.length}}});return [1,2].toLocaleString();",
  "return Array.prototype.map.call({0:4,length:1},value=>value+1);",
  "const log=[];const locales={};const options={};const item={get toLocaleString(){log.push('get');return function(a,b){log.push(this===item,a===locales,b===options,arguments.length);return {toString(){log.push('string');return 'yes'}}}}};return [[item].toLocaleString(locales,options),log];",
  "return [[],[1,null,2],undefined,,false,'x'].toLocaleString('en-US');",
  "const list=[1];list.push(list,2);return list.toLocaleString('en-US');",
  "const list=[{toLocaleString(){list[1]=9;list.push(10);return 'first'}},2];return list.toLocaleString('en-US');",
  "return Array.prototype.toLocaleString.call('abc');",
  "return Array.prototype.toLocaleString.call({length:-1},{get length(){throw 42}});",
  "const list=Object.create({1:5});list.length=3;return Array.prototype.toLocaleString.call(list,'en-US');",
  "const method=Array.prototype.toLocaleString;method.label=42;Object.freeze(method);return [method.name,method.length,method.label,Object.isFrozen(method),Object.getOwnPropertyDescriptor(Array.prototype,'toLocaleString').enumerable];",
  "return [Array.prototype.map.name,Array.prototype.map.length,Array.prototype.splice.length,Object.getOwnPropertyDescriptor(Array,'prototype').writable];",
  "const list=[1];Object.setPrototypeOf(list,null);return [typeof list.map,typeof list.toLocaleString];",
  "const list=[1];Object.setPrototypeOf(list,{toLocaleString(){return 'custom'}});return list.toLocaleString();",
  "const method=Array.prototype.toString;Object.prototype.toString=function(){return 'overwritten'};return method.call({join:0});",
  "const marker={};return Object.prototype.toLocaleString.call({toString(){return marker}})===marker;",
  "const item={toString(){return this===item}};return Object.prototype.toLocaleString.call(item,1,2);",
  "const array=[1];array.join=function(){return 42};return array.toString();",
  "return [true,'x',Symbol('s'),{}].toLocaleString();",
  "const prototype=Array.prototype;prototype[0]='inherited';const value=new Array(1);return value.toLocaleString();"
])("matches array locale/prototype semantics: %s", async source => {
  expect((await run(source)).returnValue).toEqual(runInNewContext("(function(){" + source + "})()"));
});

it.each(["null", "undefined"])("rejects nullish receiver %s", async receiver => {
  expect((await run(`try{Array.prototype.toLocaleString.call(${receiver})}catch(error){return error.name}`)).returnValue).toBe("TypeError");
});

it.each(["{toLocaleString:3}", "{toLocaleString(){return Symbol()}}"])("rejects invalid element conversion %s", async item => {
  expect((await run(`try{[${item}].toLocaleString()}catch(error){return error.name}`)).returnValue).toBe("TypeError");
});

it("keeps guest exceptions identical", async () => {
  expect((await run("const marker={};try{[{toLocaleString(){throw marker}}].toLocaleString()}catch(error){return marker===error}")).returnValue).toBe(true);
});

it("keeps array locale budget failures fatal", async () => {
  await expect(run("try{Array.prototype.toLocaleString.call({length:Infinity})}catch(error){return 'caught'}", {budget:new Budget({maxSteps:100})}))
    .rejects.toMatchObject({code:"budgetExceeded"});
});

it("bounds array locale output", async () => {
  await expect(run("return [1,2,3,4].toLocaleString();", {budget:new Budget({stringLength:5})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"stringLength"});
});

it.each(["pending", "completed"])("replays array locale conversion from %s state", async mode => {
  const source="const value=[{toLocaleString(){return 'ok'}}];await 0;return value.toLocaleString();";
  const pending=run(source);
  const completed=pending.catch(error=>error);
  try {
    if(mode==="completed")await completed;
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    expect(await completed).toMatchObject({ok:true,returnValue:"ok"});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:"ok"});
  } finally {await completed;}
});

it.each(["pending", "completed"])("replays retained Array methods and prototype changes from %s state", async mode => {
  const source="const prototype=Array.prototype;const method=prototype.toLocaleString;method.label=7;prototype.label=9;await 0;return [prototype===Object.getPrototypeOf([]),method.call([1,null,'x']),method.label,prototype.label];";
  const pending=run(source);
  const completed=pending.catch(error=>error);
  try {
    if(mode==="completed")await completed;
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    const expected={ok:true,returnValue:[true,"1,,x",7,9]};
    expect(await completed).toMatchObject(expected);
    expect(await run(source,{snapshot})).toMatchObject(expected);
  } finally {await completed;}
});

it.each([
  "return [1234.5,null,undefined,BigInt('9223372036854775807')].toLocaleString('de-DE');",
  "return Array.prototype.toLocaleString.call({0:{toLocaleString(locales,options){return locales+options.tag}},length:1},'en',{tag:'!'});"
])("supports array locale conversion: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

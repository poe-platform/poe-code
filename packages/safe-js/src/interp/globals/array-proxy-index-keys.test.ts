import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  ["flat", "1"],
  ["flatMap", "x=>x"],
  ["map", "x=>x"],
  ["filter", "()=>true"],
  ["reduce", "(a,b)=>a+b,0"],
  ["reduceRight", "(a,b)=>a+b,0"],
  ["forEach", "()=>{}"],
  ["some", "()=>false"],
  ["every", "()=>true"],
  ["find", "()=>false"],
  ["findLast", "()=>false"],
  ["includes", "9"],
  ["indexOf", "9"],
  ["lastIndexOf", "9"],
  ["slice", ""],
  ["toReversed", ""],
  ["toSorted", ""],
  ["toSpliced", "1,0"],
  ["with", "1,8"],
])("passes string index keys to Proxy reads in %s", async (method, args) => {
  const source = `const events=[];const proxy=new Proxy([2,3],{
    get(target,key,receiver){events.push([typeof key,key]);return Reflect.get(target,key,receiver)}
  });const result=Array.prototype.${method}.call(proxy,${args});return [result,events];`;
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["flat", "flatMap"])("preserves string-only Proxy index behavior in %s", async method => {
  const source = `const inner=new Proxy([1,2],{get(target,key,receiver){
    if(typeof key!=='string'&&typeof key!=='symbol')throw 'non-property-key';
    return Reflect.get(target,key,receiver)
  }});return [inner].${method}(${method === "flat" ? "1" : "x=>x"});`;
  expect(await run(source)).toMatchObject({ ok: true,
    returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
});

it.each(["Object.fromEntries([entry])", "Array.from(new Map([entry]))"])("normalizes entry reads in %s", async expression => {
  const source = `const events=[];const entry=new Proxy(['key',7],{
    get(target,key,receiver){events.push([typeof key,key]);return Reflect.get(target,key,receiver)}
  });const result=${expression};return [result,events];`;
  expect(await run(source)).toMatchObject({ ok: true,
    returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
});

it.each(["map", "filter", "find", "flatMap"])("normalizes %s reads through a Proxy prototype without changing the receiver", async method => {
  const source = `const events=[];let receiver;const parent=new Proxy({0:3,1:4,length:2},{
    get(target,key,actualReceiver){events.push([typeof key,key,actualReceiver===receiver]);return Reflect.get(target,key,actualReceiver)}
  });receiver=Object.create(parent);const result=Array.prototype.${method}.call(receiver,x=>x);return [result,events];`;
  expect(await run(source)).toMatchObject({ ok: true,
    returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
});

it.each(["pending", "completed"])("preserves string index keys through %s checkpoints", async mode => {
  const source = "const keys=[];const proxy=new Proxy([3,4],{get(t,k,r){keys.push([typeof k,k]);return Reflect.get(t,k,r)}});await 0;const result=Array.prototype.map.call(proxy,x=>x+1);return [result,keys];";
  const expected = await runInNewContext(`(async function(){"use strict";${source}})()`);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
  } finally { await completed; }
});

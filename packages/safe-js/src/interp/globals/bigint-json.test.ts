import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it("preserves converted BigInt JSON across checkpoint replay", async () => {
  const source="BigInt.prototype.toJSON=function(key){return key+':'+this};const json=JSON.stringify({value:9007199254740993n});delete BigInt.prototype.toJSON;await 0;return json;";
  const pending=run(source);
  const completed=pending.catch(error=>error);
  try {
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    const expected={ok:true,returnValue:'{"value":"value:9007199254740993"}'};
    expect(await completed).toMatchObject(expected);
    expect(await run(source,{snapshot})).toMatchObject(expected);
  } finally { await completed; }
});

it.each([
  "BigInt.prototype.toJSON=function(key){return key+':'+this};return JSON.stringify({value:3n,list:[4n]});",
  "const calls=[];BigInt.prototype.toJSON=function(key){calls.push([typeof this,key]);return String(this)};const json=JSON.stringify(3n);return [json,calls];",
  "const calls=[];Object.defineProperty(BigInt.prototype,'toJSON',{configurable:true,get(){calls.push(typeof this);return function(key){calls.push(key);return 'converted'}}});const json=JSON.stringify([2n]);return [json,calls];",
  "BigInt.prototype.toJSON=function(){return 7};return JSON.stringify(3n,(key,value)=>typeof value==='number'?value+1:value);",
  "BigInt.prototype.toJSON=function(){return undefined};return [JSON.stringify(1n),JSON.stringify({x:1n}),JSON.stringify([1n])];",
  "BigInt.prototype.toJSON=function(){throw new RangeError('hook')};try{return JSON.stringify(1n)}catch(error){return [error.name,error.message]}",
  "BigInt.prototype.toJSON=1;try{return JSON.stringify(1n)}catch(error){return error.name}",
  "BigInt.prototype.toJSON=function(){return this};try{return JSON.stringify(1n)}catch(error){return error.name}",
  "BigInt.prototype.toJSON=function(){return 'inherited'};const box=Object(2n);box.toJSON=function(){return 'own'};return JSON.stringify([2n,box]);"
])("honors BigInt JSON hooks: %s", async body => {
  const source=`try{${body}}finally{delete BigInt.prototype.toJSON}`;
  const expected:unknown=Function('"use strict";'+source)();
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

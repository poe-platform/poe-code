import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { Budget } from "./budget.js";

it.each([
  {source:'return Array.from(Uint8Array.fromHex("00aF10FF"))',expected:[0,175,16,255]},
  {source:'return new Uint8Array([0,1,15,16,175,255]).toHex()',expected:"00010f10afff"},
  {source:'const value=new Uint8Array([9,9,9]);const result=value.setFromHex("00Af");return [result,Array.from(value)]',expected:[{read:4,written:2},[0,175,9]]},
  {source:'const value=new Uint8Array(1);return [value.setFromHex("ffZZ"),value.toHex()]',expected:[{read:2,written:1},"ff"]},
  {source:'const value=new Uint8Array([9,9,9]);let error;try{value.setFromHex("aaZZbb")}catch(e){error=e.name}return [error,Array.from(value)]',expected:["SyntaxError",[170,9,9]]},
  {source:'const value=new Uint8Array([9,9]);let error;try{value.setFromHex("aab")}catch(e){error=e.name}return [error,Array.from(value)]',expected:["SyntaxError",[9,9]]},
  {source:'class Bytes extends Uint8Array{};const value=Bytes.fromHex("ff");return [value instanceof Bytes,value instanceof Uint8Array,value.toHex()]',expected:[false,true,"ff"]},
  {source:'return [Uint8Array.fromHex.call(null,"ff").toHex(),new Uint8Array(0).setFromHex("ZZ")]',expected:["ff",{read:0,written:0}]},
  {source:'return [Uint8Array.fromHex.length,Uint8Array.prototype.toHex.length,Uint8Array.prototype.setFromHex.length,typeof Int8Array.prototype.toHex,typeof Uint8ClampedArray.prototype.toHex]',expected:[1,0,1,"undefined","undefined"]}
])("supports hexadecimal conversion: $source", async ({source,expected}) => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it.each(['"f"','"ff "','"0x"','"gg"','"０１"'])("rejects invalid hex text %s", input =>
  expect(run(`try{Uint8Array.fromHex(${input});return "accepted"}catch(error){return error.name}`))
    .resolves.toMatchObject({ok:true,returnValue:"SyntaxError"}));

it.each(['undefined','17','new String("ff")','{toString(){throw 1}}'])("does not coerce hex input %s", input =>
  expect(run(`try{Uint8Array.fromHex(${input});return "accepted"}catch(error){return error.name}`))
    .resolves.toMatchObject({ok:true,returnValue:"TypeError"}));

it.each(["{}", "new Uint8ClampedArray(1)", "new Int8Array(1)", "new Uint16Array(1)"])
  ("rejects non-byte receivers %s", receiver => expect(run(`try{return Uint8Array.prototype.toHex.call(${receiver})}catch(error){return error.name}`))
    .resolves.toMatchObject({ok:true,returnValue:"TypeError"}));

it.each(["toHex()",'setFromHex("ff")'])("rejects invalid view bounds for %s", operation =>
  expect(run(`const buffer=new ArrayBuffer(4,{maxByteLength:8});const value=new Uint8Array(buffer,2,2);buffer.resize(1);try{value.${operation};return "accepted"}catch(error){return error.name}`))
    .resolves.toMatchObject({ok:true,returnValue:"TypeError"}));

it("uses internal view dimensions instead of shadowed metadata", async () => {
  expect(await run('const value=new Uint8Array([1,2]);Object.defineProperty(value,"length",{get(){throw 1}});return [value.toHex(),value.setFromHex("aabb").written]'))
    .toMatchObject({ok:true,returnValue:["0102",2]});
});

it("bounds encoded string length and decoded array length", async () => {
  await expect(run("return new Uint8Array(6).toHex()",{budget:new Budget({stringLength:10})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"stringLength"});
  await expect(run('return Uint8Array.fromHex("010203")',{budget:new Budget({arrayLength:2})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
});

it("preserves static and instance method identities across public dump/restore", async () => {
  const source = 'const from=Uint8Array.fromHex;const to=Uint8Array.prototype.toHex;const set=Uint8Array.prototype.setFromHex;const value=from("abcd");await 0;return [from===Uint8Array.fromHex,to===value.toHex,set===value.setFromHex,to.call(value)]';
  const result = await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[true,true,true,"abcd"]});
  const snapshot = restore(JSON.parse(await dump(result)),{source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[true,true,true,"abcd"]});
});

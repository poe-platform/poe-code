import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { Budget } from "./budget.js";

it.each(["base64", "base64url"] as const)("matches native Buffer encoding across lengths and byte values: %s", async alphabet => {
  for (const length of [0,1,2,3,4,5,31,32,33,256]) {
    const bytes = Array.from({length}, (_, index) => index & 255);
    const encoded = Buffer.from(bytes).toString(alphabet);
    const omitPadding = alphabet === "base64url";
    expect(await run(`const value=new Uint8Array(${JSON.stringify(bytes)});return [value.toBase64({alphabet:${JSON.stringify(alphabet)},omitPadding:${omitPadding}}),Array.from(Uint8Array.fromBase64(${JSON.stringify(encoded)},{alphabet:${JSON.stringify(alphabet)}}))]`))
      .toMatchObject({ok:true,returnValue:[encoded,bytes]});
  }
});

it.each([
  ["Zg",1,2,1,"66"], ["Zm8",2,3,2,"666f"], ["Zm9v",2,0,0,"0000"],
  ["Zm9v ",3,4,3,"666f6f"], ["Zm9v ",4,5,3,"666f6f00"],
  ["Zg== ",1,5,1,"66"], ["Zh==",1,4,1,"66"], ["Zm9=",2,4,2,"666f"],
  ["Zm9vZg==",4,8,4,"666f6f66"]
])("handles capacity and read offsets for %s into %s bytes", async (text,length,read,written,hex) => {
  expect(await run(`const value=new Uint8Array(${length});return [value.setFromBase64(${JSON.stringify(text)}),value.toHex()]`))
    .toMatchObject({ok:true,returnValue:[{read,written},hex]});
});

it.each(['"Zg!"', '"Zg==!"'])("validates the character before the capacity cutoff: %s", text =>
  expect(run(`try{new Uint8Array(1).setFromBase64(${text});return "accepted"}catch(error){return error.name}`))
    .resolves.toMatchObject({ok:true,returnValue:"SyntaxError"}));

it.each([
  ["", ""], ["66", "Zg=="], ["666f", "Zm8="], ["666f6f", "Zm9v"],
  ["666f6f62", "Zm9vYg=="], ["666f6f6261", "Zm9vYmE="], ["666f6f626172", "Zm9vYmFy"],
  ["fbffff", "+///"]
])("round-trips hex %s through base64 %s", async (hex, base64) => {
  expect(await run(`return [Uint8Array.fromHex(${JSON.stringify(hex)}).toBase64(),Uint8Array.fromBase64(${JSON.stringify(base64)}).toHex()]`))
    .toMatchObject({ok:true,returnValue:[base64,hex]});
});

it.each([
  {source:'return [new Uint8Array([251,255,255]).toBase64({alphabet:"base64url"}),Uint8Array.fromBase64("-___",{alphabet:"base64url"}).toHex()]',expected:["-___","fbffff"]},
  {source:'return [new Uint8Array([102]).toBase64({omitPadding:true}),new Uint8Array([102,111]).toBase64({omitPadding:{}})]',expected:["Zg","Zm8"]},
  {source:'return Uint8Array.fromBase64(" Z g= \\t= \\n").toHex()',expected:"66"},
  {source:'return [Uint8Array.fromBase64("Zg").toHex(),Uint8Array.fromBase64("Zm8").toHex()]',expected:["66","666f"]},
  {source:'return Uint8Array.fromBase64("Zm9vZg",{lastChunkHandling:"stop-before-partial"}).toHex()',expected:"666f6f"},
  {source:'const value=new Uint8Array(1);return [value.setFromBase64("Zm9v"),value.toHex()]',expected:[{read:0,written:0},"00"]},
  {source:'const value=new Uint8Array(1);return [value.setFromBase64("Zg=="),value.toHex()]',expected:[{read:4,written:1},"66"]},
  {source:'const value=new Uint8Array(3);return [value.setFromBase64("Zm9v!!"),value.toHex()]',expected:[{read:4,written:3},"666f6f"]},
  {source:'const value=new Uint8Array([9,9,9,9]);let error;try{value.setFromBase64("Zm9v!!")}catch(e){error=e.name}return [error,value.toHex()]',expected:["SyntaxError","666f6f09"]},
  {source:'return new Uint8Array(0).setFromBase64("!")',expected:{read:0,written:0}},
  {source:'const value=new Uint8Array(4);return [value.setFromBase64("Zm9v Zg=",{lastChunkHandling:"stop-before-partial"}),value.toHex()]',expected:[{read:4,written:3},"666f6f00"]},
  {source:'class Bytes extends Uint8Array{};return [Bytes.fromBase64("Zg==") instanceof Bytes,Uint8Array.fromBase64.call(null,"Zg==").toHex()]',expected:[false,"66"]},
  {source:'const events=[];const buffer=new ArrayBuffer(1);const value=new Uint8Array(buffer);try{value.toBase64({get alphabet(){events.push("alphabet");buffer.transfer();return "base64"},get omitPadding(){events.push("padding");return false}})}catch(error){return [error.name,events]}',expected:["TypeError",["alphabet","padding"]]},
  {source:'const events=[];const value=Uint8Array.fromBase64("Zg==",{get alphabet(){events.push("alphabet");return "base64"},get lastChunkHandling(){events.push("chunk");return "strict"}});return [value.toHex(),events]',expected:["66",["alphabet","chunk"]]}
])("supports base64 semantics: $source", async ({source,expected}) => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it.each([
  '"Z"', '"=Zg"', '"Zg="', '"Zg==!"', '"Zg==="', '"Zg\\u000b=="',
  '"Zg",{lastChunkHandling:"strict"}', '"Zh==",{lastChunkHandling:"strict"}',
  '"Zm9=",{lastChunkHandling:"strict"}', '"+///",{alphabet:"base64url"}', '"-___"'
])("rejects invalid base64 input/options %s", args =>
  expect(run(`try{Uint8Array.fromBase64(${args});return "accepted"}catch(error){return error.name}`))
    .resolves.toMatchObject({ok:true,returnValue:"SyntaxError"}));

it.each(['undefined', '17', 'new String("Zg==")', '{toString(){throw 1}}'])("does not coerce input %s", input =>
  expect(run(`try{Uint8Array.fromBase64(${input});return "accepted"}catch(error){return error.name}`))
    .resolves.toMatchObject({ok:true,returnValue:"TypeError"}));

it.each(['null', '17', '"base64"', '{alphabet:null}', '{alphabet:{toString(){throw 1}}}', '{lastChunkHandling:"invalid"}'])
  ("rejects invalid options %s", options => expect(run(`try{Uint8Array.fromBase64("",${options});return "accepted"}catch(error){return error.name}`))
    .resolves.toMatchObject({ok:true,returnValue:"TypeError"}));

it.each(["{}", "new Int8Array(1)", "new Uint8ClampedArray(1)", "new Uint16Array(1)"])
  ("validates receiver before reading options: %s", receiver => expect(run(`const options={get alphabet(){throw "getter"}};const errors=[];for(const method of [Uint8Array.prototype.toBase64,Uint8Array.prototype.setFromBase64]){try{method.call(${receiver},options,options)}catch(error){errors.push(error.name)}}return errors`))
    .resolves.toMatchObject({ok:true,returnValue:["TypeError","TypeError"]}));

it.each(["toBase64()", 'setFromBase64("Zg==")'])("rejects out-of-bounds views for %s", operation =>
  expect(run(`const buffer=new ArrayBuffer(4,{maxByteLength:8});const value=new Uint8Array(buffer,2,2);buffer.resize(1);try{value.${operation};return "accepted"}catch(error){return error.name}`))
    .resolves.toMatchObject({ok:true,returnValue:"TypeError"}));

it("reads receiver bounds after options resize the backing buffer", async () => {
  expect(await run('const buffer=new ArrayBuffer(4,{maxByteLength:8});const value=new Uint8Array(buffer);const result=value.setFromBase64("Zm9v",{get lastChunkHandling(){buffer.resize(1);return "loose"}});return [result,value.toHex()]'))
    .toMatchObject({ok:true,returnValue:[{read:0,written:0},"00"]});
});

it("ignores shadowed dimensions and uses null-prototype default options", async () => {
  expect(await run('Object.prototype.alphabet="invalid";const value=new Uint8Array([102]);Object.defineProperty(value,"length",{get(){throw 1}});return [value.toBase64(),value.setFromBase64("Zw=="),Uint8Array.fromBase64("Zg==").toHex()]'))
    .toMatchObject({ok:true,returnValue:["Zg==",{read:4,written:1},"66"]});
});

it("bounds decoded arrays, encoded strings and whitespace scanning", async () => {
  await expect(run('return Uint8Array.fromBase64("Zm9v")',{budget:new Budget({arrayLength:2})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
  await expect(run('return new Uint8Array(6).toBase64()',{budget:new Budget({stringLength:7})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"stringLength"});
  await expect(run(`return Uint8Array.fromBase64(${JSON.stringify(" ".repeat(1000))})`,{budget:new Budget({maxSteps:100})}))
    .rejects.toMatchObject({code:"budgetExceeded"});
});

it("retains intrinsic method identities across public dump and restore", async () => {
  const source='const from=Uint8Array.fromBase64;const to=Uint8Array.prototype.toBase64;const set=Uint8Array.prototype.setFromBase64;const value=from("Zg==");await 0;return [from===Uint8Array.fromBase64,to===value.toBase64,set===value.setFromBase64,to.call(value)]';
  const result=await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[true,true,true,"Zg=="]});
  const snapshot=restore(JSON.parse(await dump(result)),{source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[true,true,true,"Zg=="]});
});

it("exposes standard metadata only on Uint8Array", async () => {
  expect(await run('const from=Object.getOwnPropertyDescriptor(Uint8Array,"fromBase64");const to=Object.getOwnPropertyDescriptor(Uint8Array.prototype,"toBase64");const set=Object.getOwnPropertyDescriptor(Uint8Array.prototype,"setFromBase64");return [[from.value.name,from.value.length,to.value.name,to.value.length,set.value.name,set.value.length],[from,to,set].map(d=>[d.writable,d.enumerable,d.configurable]),typeof Int8Array.fromBase64,typeof Uint8ClampedArray.prototype.toBase64]'))
    .toMatchObject({ok:true,returnValue:[["fromBase64",1,"toBase64",0,"setFromBase64",1],[[true,false,true],[true,false,true],[true,false,true]],"undefined","undefined"]});
});

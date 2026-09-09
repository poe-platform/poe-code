import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'Object.defineProperty(globalThis,"fresh",{value:3,writable:false,configurable:true});(0,eval)("{function fresh(){return 7}}");return fresh',
  'Object.defineProperty(globalThis,"fresh",{value:3,writable:false,configurable:false});(0,eval)("{function fresh(){return 7}}");return fresh',
  'let writes=0;let saved;Object.defineProperty(globalThis,"fresh",{set(v){writes++;saved=v},configurable:true});(0,eval)("{function fresh(){return 7}}");return [writes,saved()]',
  'let writes=0;Object.defineProperty(globalThis,"fresh",{set(){writes++;throw 9},configurable:true});try{(0,eval)("{function fresh(){return 7}}")}catch(e){return [e,writes]}',
  'Object.defineProperty(globalThis,"fresh",{get(){return 3},configurable:true});(0,eval)("{function fresh(){return 7}}");return fresh',
  'let writes=0;Object.defineProperty(globalThis,"fresh",{set(){writes++},configurable:true});(0,eval)("if(false){function fresh(){return 7}}");return writes'
])("assigns legacy global eval block functions: %s", async source => {
  const expected: unknown = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

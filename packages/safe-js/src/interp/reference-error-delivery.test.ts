import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  'return await Promise.resolve().then(()=>missing).catch(e=>[e.name,e instanceof ReferenceError])',
  'function* f(){return missing}try{f().next()}catch(e){return [e.name,e instanceof ReferenceError]}',
  'async function f(){return missing}try{await f()}catch(e){return [e.name,e instanceof ReferenceError]}',
  'async function* f(){return missing}try{await f().next()}catch(e){return [e.name,e instanceof ReferenceError]}',
  'const [entry]=await Promise.allSettled([Promise.resolve().then(()=>missing)]);return [entry.status,entry.reason instanceof ReferenceError]',
  'const p=Promise.resolve().then(()=>missing);const [a,b]=await Promise.allSettled([p,p]);return [a.reason===b.reason,a.reason instanceof ReferenceError]',
  'const reason={code:"UNBOUND_IDENTIFIER",message:"guest",nodeType:"Identifier",span:{}};return await Promise.resolve().then(()=>{throw reason}).catch(e=>e===reason)',
  'const reason={code:"UNBOUND_IDENTIFIER",message:"guest",nodeType:"Identifier",span:{}};function* f(){throw reason}try{f().next()}catch(e){return e===reason}'
])("delivers source reference errors as guest error instances: %s", async source => {
  const expected: unknown = await runInNewContext(`(async function(){'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

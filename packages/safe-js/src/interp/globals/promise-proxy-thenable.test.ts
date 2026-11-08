import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'const p=new Proxy(new Proxy({then(resolve){resolve(5)}},{}),{});return await Promise.resolve(p)',
  'const events=[];const p=new Proxy({}, {get(t,k){events.push("get:"+String(k));return function(resolve){events.push("call");resolve(3)}}});const pending=Promise.resolve(p);events.push("after resolve");const value=await pending;return [value,events]',
  'const p=new Proxy({}, {get(){return new Proxy(function(resolve){resolve(8)},{})}});return await Promise.resolve(p)',
  'const p=new Proxy({}, {get(){return 1}});return (await Promise.resolve(p))===p',
  'const p=new Proxy({then(resolve){resolve(4)}},{});return await Promise.resolve(1).then(()=>p)',
  'const p=new Proxy({then(resolve){resolve(4)}},{});async function f(){return p}return await f()',
  'const p=new Proxy({then(resolve){resolve(3)}},{});return await Promise.resolve(p)',
  'const p=new Proxy({then(resolve){resolve(3)}},{});return await p',
  'const p=new Proxy({}, {get(t,k,r){if(k==="then")return function(resolve){resolve(this===p)}}});return await Promise.resolve(p)',
  'const p=new Proxy({}, {get(){throw new RangeError("read")}});try{return await Promise.resolve(p)}catch(e){return e.name}',
  'const r=Proxy.revocable({},{});r.revoke();try{return await Promise.resolve(r.proxy)}catch(e){return e.name}',
  'const events=[];const p=new Proxy({}, {get(t,k){events.push(String(k));return undefined}});const result=await Promise.resolve(p);return [result===p,events]',
  'const p=new Proxy(function(){},{get(t,k){return k==="then"?resolve=>resolve(7):undefined}});return await Promise.resolve(p)'
])("matches native wrapped thenable resolution: %s", async source => {
  const expected = await new Function(`return (async()=>{${source}})()`)();
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'const p={x:4};Object.defineProperty(p,"then",{get:new Proxy(function(){return resolve=>resolve(this.x)}, {})});return await Promise.resolve(p)',
  'const p={};const events=[];Object.defineProperty(p,"then",{get:new Proxy(()=>undefined,{apply(t,r,a){events.push([r===p,a.length]);return resolve=>resolve(7)}})});return [await p,events]',
  'const p={};Object.defineProperty(p,"then",{get:new Proxy(()=>undefined,{apply(){throw new RangeError("getter")}})});try{return await Promise.resolve(p)}catch(e){return [e.name,e.message]}',
  'const p={};const r=Proxy.revocable(()=>undefined,{});Object.defineProperty(p,"then",{get:r.proxy});r.revoke();try{return await Promise.resolve(p)}catch(e){return e.name}',
  'const proto={};Object.defineProperty(proto,"then",{get:new Proxy(function(){return resolve=>resolve(this.x)}, {})});const p=Object.create(proto);p.x=8;return await Promise.resolve().then(()=>p)',
  'const p={};Object.defineProperty(p,"then",{get:new Proxy(new Proxy(()=>resolve=>resolve(9),{}),{})});async function f(){return p}return await f()'
])("matches native Proxy then getter: %s", async source => {
  const expected = await new Function(`return (async()=>{${source}})()`)();
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

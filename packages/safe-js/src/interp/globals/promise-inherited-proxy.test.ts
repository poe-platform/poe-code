import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'const r=Proxy.revocable({},{});const p=Object.create(r.proxy);Object.defineProperty(p,"then",{value:undefined});r.revoke();return (await Promise.resolve(p))===p',
  'const proto=new Proxy({}, {get(){throw 1}});const p=Object.create(proto);Object.defineProperty(p,"then",{value:resolve=>resolve(6)});return await Promise.resolve(p)',
  'const proto=new Proxy({then(resolve){resolve(4)}},{});const p=Object.create(Object.create(proto));async function f(){return p}return await f()',
  'const proto=new Proxy({then(resolve){resolve(this.x)}},{});const p=Object.create(proto);p.x=3;return await Promise.resolve(p)',
  'const proto=new Proxy({}, {get(t,k,r){if(k==="then")return function(resolve){resolve(this===p&&r===p)}}});const p=Object.create(proto);return await p',
  'const proto=new Proxy({}, {get(){throw new RangeError("read")}});const p=Object.create(proto);try{return await Promise.resolve(p)}catch(e){return e.name}',
  'const r=Proxy.revocable({},{});const p=Object.create(r.proxy);r.revoke();try{return await Promise.resolve(p)}catch(e){return e.name}',
  'const events=[];const proto=new Proxy({}, {get(t,k){events.push(String(k));return undefined}});const p=Object.create(proto);return [(await Promise.resolve(p))===p,events]',
  'const proto=new Proxy({then(resolve){resolve(4)}},{});const p=Object.create(proto);return await Promise.resolve().then(()=>p)'
])("matches native inherited Proxy resolution: %s", async source => {
  const expected = await new Function(`return (async()=>{${source}})()`)();
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

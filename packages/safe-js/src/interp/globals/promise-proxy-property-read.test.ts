import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'class C extends Promise{};const p=Promise.resolve(1);const events=[];const constructor=new Proxy({}, {get(t,k,r){events.push([k===Symbol.species,r===constructor]);return C}});p.constructor=constructor;const q=p.then(x=>x+1);return [q instanceof C,await q,events]',
  'class C extends Promise{};const p=Promise.resolve(1);const constructor=Object.create(new Proxy({}, {get(t,k,r){if(k===Symbol.species)return r===constructor?C:undefined}}));p.constructor=constructor;const q=p.then(x=>x+1);return [q instanceof C,await q]',
  'const p=Promise.resolve(1);const r=Proxy.revocable({},{});p.constructor=r.proxy;r.revoke();try{p.then()}catch(e){return e.name}',
  'const p=Promise.resolve(1);const r=Proxy.revocable({},{});p.constructor=Object.create(r.proxy);Object.defineProperty(p.constructor,Symbol.species,{value:undefined});r.revoke();return await p.then(x=>x+1)',
  'const p=Promise.resolve(1);const events=[];Object.setPrototypeOf(p,new Proxy(Promise.prototype,{get(t,k,r){events.push(String(k));return Reflect.get(t,k,r)}}));return [await p,events]',
  'const p=Promise.resolve(1);Object.setPrototypeOf(p,new Proxy(Promise.prototype,{get(t,k,r){if(k==="constructor")throw new RangeError("constructor");return Reflect.get(t,k,r)}}));try{return await p}catch(e){return [e.name,e.message]}',
  'const p=Promise.resolve(1);p.constructor=new Proxy({}, {get(t,k){if(k===Symbol.species)return Promise}});return await p.then(x=>x+1)',
  'const p=Promise.resolve(1);p.constructor=new Proxy({}, {get(t,k){if(k===Symbol.species)throw new RangeError("species")}});try{return await p.then(x=>x+1)}catch(e){return [e.name,e.message]}',
  'const p=Promise.resolve(1);p.constructor=Object.create(new Proxy({}, {get(t,k){if(k===Symbol.species)return Promise}}));return await p.then(x=>x+1)',
  'const p=Promise.resolve(1);p.constructor=Object.create(new Proxy({}, {get(t,k){if(k===Symbol.species)throw new RangeError("inherited species")}}));try{return await p.then(x=>x+1)}catch(e){return [e.name,e.message]}'
])("matches native Proxy Promise property reads: %s", async source => {
  const expected = await new Function(`return (async()=>{${source}})()`)();
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

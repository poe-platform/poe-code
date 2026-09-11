import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'const p=Promise.resolve(1);p.then=new Proxy(function(){return 4},{});return p.catch(()=>2)',
  'const p=Promise.resolve(1);p.then=new Proxy(function(){return 4},{});return p.finally(()=>2)',
  'return await new Promise(new Proxy(function(resolve){resolve(3)},{}))',
  'const P=new Proxy(Promise,{});return await P.resolve(3)',
  'const P=new Proxy(Promise,{});return await P.all([1,Promise.resolve(2)])',
  'const P=new Proxy(Promise,{});return await P.race([Promise.resolve(3)])',
  'const P=new Proxy(Promise,{});return await P.allSettled([1,Promise.reject(2)])',
  'const P=new Proxy(Promise,{});return await P.any([Promise.reject(1),2])',
  'const f=new Proxy(x=>x+1,{});return await Promise.resolve(1).then(f)',
  'const f=new Proxy(()=>3,{});return await Promise.reject(1).catch(f)',
  'const f=new Proxy(()=>3,{});return await Promise.resolve(1).finally(f)',
  'const then=new Proxy(function(resolve){resolve(3)},{});return await Promise.resolve({then})',
  'const events=[];const P=new Proxy(Promise,{construct(t,args,n){events.push(n===P);return Reflect.construct(t,args,n)}});const result=await P.all([1,2]);return [result,events]',
  'const resolve=new Proxy(Promise.resolve,{apply(t,receiver,args){return Reflect.apply(t,receiver,args)}});class P extends Promise{};P.resolve=resolve;return await P.all([1,2])'
])("matches native Promise Proxy behavior: %s", async source => {
  const expected = await new Function(`return (async()=>{${source}})()`)();
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

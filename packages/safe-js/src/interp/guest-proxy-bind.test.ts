import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  'const p=new Proxy(function(){},{getPrototypeOf(){return null}});const b=Function.prototype.bind.call(p,null);return Object.getPrototypeOf(b)===null',
  'const p=new Proxy(function(){},{get(t,k){return k==="length"?Infinity:k==="name"?17:undefined}});const b=Function.prototype.bind.call(p,null,1);return [b.length===Infinity,b.name]',
  'const proto={};const inner=new Proxy(function(){},{getPrototypeOf(){return proto}});const p=new Proxy(inner,{});const b=Function.prototype.bind.call(p,null);return Object.getPrototypeOf(b)===proto',
  'let r;r=Proxy.revocable(function(){},{getPrototypeOf(){r.revoke();return null}});try{Function.prototype.bind.call(r.proxy,null)}catch(e){return e.name}',
  'const p=new Proxy(function f(a,b){return a+b},{});const b=p.bind(null,1);return [b.name,b.length,b(2)]',
  'const proto={marker:1};const p=new Proxy(function(){},{getPrototypeOf(){return proto}});const b=Function.prototype.bind.call(p,null);return Object.getPrototypeOf(b)===proto',
  'const p=new Proxy(function(){},{getPrototypeOf(){throw new RangeError("proto")}});try{return Function.prototype.bind.call(p,null)}catch(e){return e.name}',
  'const r=Proxy.revocable(function(){},{});r.revoke();try{return Function.prototype.bind.call(r.proxy,null)}catch(e){return e.name}',
  'const p=new Proxy(function(){},{getOwnPropertyDescriptor(t,k){return k==="length"?undefined:Reflect.getOwnPropertyDescriptor(t,k)},get(t,k,r){if(k==="length")throw 1;return Reflect.get(t,k,r)}});return Function.prototype.bind.call(p,null).length'
])("matches native Proxy binding: %s", async source => {
  const observed = `const result=(function(){${source}})();return JSON.stringify(result)`;
  expect(await run(observed)).toMatchObject({ok: true, returnValue: new Function(observed)()});
});

it("matches native bind trap order and receivers", async () => {
  const source = `const events=[];const p=new Proxy(function f(a,b){},{
    getPrototypeOf(t){events.push("prototype");return Reflect.getPrototypeOf(t)},
    getOwnPropertyDescriptor(t,k){events.push("descriptor:"+String(k));return Reflect.getOwnPropertyDescriptor(t,k)},
    get(t,k,r){events.push(["get:"+String(k),r===p]);return Reflect.get(t,k,r)}
  });const b=Function.prototype.bind.call(p,null,1);return [b.name,b.length,events]`;
  expect(await run(source)).toMatchObject({ok: true, returnValue: new Function(source)()});
});

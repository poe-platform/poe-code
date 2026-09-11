import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'const events=[];const p=new Proxy([1,2],{get(t,k){if(k==="length")return {valueOf(){events.push("length");return 1}};return Reflect.get(t,k)}});return [JSON.stringify(p),events]',
  'const p=new Proxy([],{get(t,k){return k==="length"?1n:undefined}});try{return JSON.stringify(p)}catch(e){return e.name}',
  'const p=new Proxy([1],{get(t,k){return k==="length"?-1:Reflect.get(t,k)}});return JSON.stringify(p)',
  'const p=new Proxy({a:1,b:2},{get(t,k){if(k==="a")Object.defineProperty(t,"b",{enumerable:false});return Reflect.get(t,k)}});return JSON.stringify(p)',
  'const p=new Proxy({a:1,b:2},{getOwnPropertyDescriptor(t,k){if(k==="a")delete t.b;return Reflect.getOwnPropertyDescriptor(t,k)}});return JSON.stringify(p)',
  'const p=new Proxy({a:1,[Symbol()]:2},{getOwnPropertyDescriptor(t,k){if(typeof k==="symbol")throw 1;return Reflect.getOwnPropertyDescriptor(t,k)}});return JSON.stringify(p)',
  'const p=new Proxy({a:1},{ownKeys(){throw new RangeError("keys")}});try{return JSON.stringify(p)}catch(e){return e.name}',
  'const p=new Proxy({}, {ownKeys(){return ["a","a"]}});try{return JSON.stringify(p)}catch(e){return e.name}',
  'const r=Proxy.revocable([],{});r.revoke();try{return JSON.stringify({},r.proxy)}catch(e){return e.name}',
  'return JSON.stringify({a:1},new Proxy(function(k,v){return typeof v==="number"?v+1:v},{}))',
  'return JSON.stringify({toJSON:new Proxy(function(){return 4},{})})',
  'return JSON.stringify(new Proxy({a:1},{}))',
  'return JSON.stringify(new Proxy([1,,3],{}))',
  'return JSON.stringify(new Proxy(new Proxy([1,2],{}),{}),null,2)',
  'return JSON.stringify({a:1,b:2},new Proxy(["b"],{}))',
  'const p=new Proxy([1,2,3],{get(t,k){return k==="length"?1.9:Reflect.get(t,k)}});return JSON.stringify(p)',
  'const p=new Proxy({}, {ownKeys(){return ["virtual"]},getOwnPropertyDescriptor(){return {enumerable:true,configurable:true}},get(t,k){return k==="virtual"?4:undefined}});return JSON.stringify(p)',
  'const p=new Proxy({a:1},{ownKeys(){throw 1}});return JSON.stringify(p,["a"])',
  'const p=new Proxy(function(){},{});return [JSON.stringify(p),JSON.stringify([p]),JSON.stringify({p})]',
  'const p=new Proxy(function(){},{get(t,k){return k==="toJSON"?()=>4:undefined}});return JSON.stringify(p)',
  'const p=new Proxy({},{});p.self=p;try{return JSON.stringify(p)}catch(e){return e.name}',
  'const r=Proxy.revocable([],{});r.revoke();try{return JSON.stringify(r.proxy)}catch(e){return e.name}'
])("matches native JSON Proxy behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
});

it.each(['{a:1,b:2}', '[1,2]'])("preserves JSON trap order for %s", async target => {
  const source = `const events=[];const p=new Proxy(${target},{
    get(t,k,r){events.push('get:'+String(k));return Reflect.get(t,k,r)},
    ownKeys(t){events.push('keys');return Reflect.ownKeys(t)},
    getOwnPropertyDescriptor(t,k){events.push('desc:'+String(k));return Reflect.getOwnPropertyDescriptor(t,k)}
  });return [JSON.stringify(p),events]`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
});

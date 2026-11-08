import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'return [typeof Proxy, Proxy.name, Proxy.length, Object.hasOwn(Proxy,"prototype")];',
  'try { Proxy({},{}); } catch(e) { return e.name; }',
  'try { new Proxy(1,{}); } catch(e) { return e.name; }',
  'try { new Proxy({},null); } catch(e) { return e.name; }',
  'const t={x:3};const p=new Proxy(t,{});p.x=4;return [p.x,t.x,"x" in p,Object.keys(p)];',
  'const t={x:3};const h={get(target,key,receiver){return [this===h,target===t,key,receiver===p];}};const p=new Proxy(t,h);return p.x;',
  'const t={};const h={set(target,key,value,receiver){target[key]=value+1;return receiver===p;}};const p=new Proxy(t,h);p.x=3;return t.x;',
  'const p=new Proxy({},{has(t,k){return k==="x";}});return ["x" in p,"y" in p];',
  'const t={x:3};const p=new Proxy(t,{deleteProperty(target,key){delete target[key];return true;}});return [delete p.x,Object.keys(t)];',
  'const p=new Proxy({a:1,b:2},{ownKeys(){return ["b","a"];}});return Object.keys(p);',
  'const p=new Proxy({},{getOwnPropertyDescriptor(){return {value:3,writable:true,enumerable:true,configurable:true};}});return Object.getOwnPropertyDescriptor(p,"x");',
  'const t={};const p=new Proxy(t,{defineProperty(target,key,d){return Reflect.defineProperty(target,key,d);}});Object.defineProperty(p,"x",{value:3});return t.x;',
  'const proto={x:7};const p=new Proxy({},{getPrototypeOf(){return proto;}});return Object.getPrototypeOf(p)===proto;',
  'const t={};const proto={};const p=new Proxy(t,{setPrototypeOf(target,value){return Reflect.setPrototypeOf(target,value);}});return [Reflect.setPrototypeOf(p,proto),Object.getPrototypeOf(t)===proto];',
  'const p=new Proxy({},{isExtensible(target){return Reflect.isExtensible(target);}});return Object.isExtensible(p);',
  'const t={};const p=new Proxy(t,{preventExtensions(target){return Reflect.preventExtensions(target);}});Object.preventExtensions(p);return Object.isExtensible(t);',
  'const f=new Proxy(function(a){return this.x+a;},{apply(target,receiver,args){return Reflect.apply(target,receiver,args)*2;}});return [typeof f,f.call({x:2},3)];',
  'const F=new Proxy(function(x){this.x=x;},{construct(target,args,newTarget){return Reflect.construct(target,args,newTarget);}});const value=new F(7);return [value.x,value instanceof F];',
  'const r=Proxy.revocable({x:1},{});const before=r.proxy.x;r.revoke();r.revoke();try{return r.proxy.x;}catch(e){return [before,e.name];}',
  'const r=Proxy.revocable(function(){},{});r.revoke();return typeof r.proxy;',
  'const p=new Proxy(Object.freeze({x:1}),{get(){return 2;}});try{return p.x;}catch(e){return e.name;}',
  'const p=new Proxy(Object.freeze({x:1}),{set(){return true;}});try{p.x=2;}catch(e){return e.name;}',
  'const p=new Proxy(Object.freeze({x:1}),{has(){return false;}});try{return "x" in p;}catch(e){return e.name;}',
  'const p=new Proxy(Object.freeze({x:1}),{deleteProperty(){return true;}});try{return delete p.x;}catch(e){return e.name;}',
  'const p=new Proxy(Object.freeze({x:1}),{ownKeys(){return [];}});try{return Reflect.ownKeys(p);}catch(e){return e.name;}',
  'const p=new Proxy({},{ownKeys(){return ["x","x"];}});try{return Reflect.ownKeys(p);}catch(e){return e.name;}',
  'const p=new Proxy(Object.preventExtensions({}),{isExtensible(){return true;}});try{return Object.isExtensible(p);}catch(e){return e.name;}',
  'const p=new Proxy({},{preventExtensions(){return true;}});try{return Reflect.preventExtensions(p);}catch(e){return e.name;}',
  'const p=new Proxy({},{get:3});try{return p.x;}catch(e){return e.name;}',
  'const s=Symbol("key");const p=new Proxy({[s]:7},{});return [p[s],Reflect.ownKeys(p)[0]===s];',
  'const target={get value(){return this.x;}};const p=new Proxy(target,{});return Reflect.get(p,"value",{x:7});',
  'return Array.isArray(new Proxy([],{}));'
])("implements guest Proxy semantics: %s", async source => {
  const expected: unknown = runInNewContext(`(function(){"use strict";${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

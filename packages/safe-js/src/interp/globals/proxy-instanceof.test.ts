import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'function C(){};const P=new Proxy(C,{});return [new C() instanceof P,new P() instanceof C,new P() instanceof P]',
  'function C(){};const P=new Proxy(new Proxy(C,{}),{});return new C() instanceof P',
  'function C(){};const P=new Proxy(C,{}).bind(null);return new C() instanceof P',
  'function C(){};const P=new Proxy(C.bind(null),{});try{return new C() instanceof P}catch(e){return e.name}',
  'const P=new Proxy({}, {get(t,k){return k===Symbol.hasInstance?v=>v===3:undefined}});return [3 instanceof P,4 instanceof P]',
  'const P=new Proxy(function(){},{get(t,k){return k===Symbol.hasInstance?new Proxy(v=>v===3,{}):undefined}});return 3 instanceof P',
  'const P=new Proxy(()=>0,{});try{return {} instanceof P}catch(e){return e.name}',
  'const r=Proxy.revocable(function(){},{});r.revoke();try{return 1 instanceof r.proxy}catch(e){return e.name}',
  'const events=[];function C(){};const P=new Proxy(C,{get(t,k,r){events.push(String(k));return Reflect.get(t,k,r)}});return [new C() instanceof P,events]',
  'return new Proxy([], {}) instanceof Array',
  'return new Proxy(new Map(),{}) instanceof Map',
  'return new Proxy(new Error(),{}) instanceof Error',
  'return new Proxy(new Uint8Array(),{}) instanceof Uint8Array',
  'return new Uint8Array() instanceof new Proxy(Uint8Array,{})'
])("matches native Proxy instanceof: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
});

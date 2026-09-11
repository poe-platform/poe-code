import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'function f(){};return new Proxy(f,{})',
  'return new Proxy(()=>0,{})',
  'return new Proxy(class C{},{})',
  'return new Proxy(new Proxy(function(){},{}),{})',
  'return new Proxy(function(){},{get(){return 17}})',
  'return new Proxy(function(){},{get(){return "Custom"}})',
  'return new Proxy(async function(){},{})',
  'return new Proxy(function*(){},{})',
  'const r=Proxy.revocable(function(){},{});r.revoke();return r.proxy'
])("matches native callable Proxy tags: %s", async setup => {
  const source = `const p=(function(){${setup}})();try{return Object.prototype.toString.call(p)}catch(e){return e.name}`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
});

it("reads the callable Proxy tag once with its original receiver", async () => {
  const source = `const events=[];const p=new Proxy(function(){},{
    get(t,k,r){events.push([k===Symbol.toStringTag,r===p]);return undefined},
    getPrototypeOf(){throw 1},getOwnPropertyDescriptor(){throw 2}
  });return [Object.prototype.toString.call(p),events]`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
});

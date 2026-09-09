import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";

it.each([
  'new Proxy({}, {get(t,k){if(k==="then")return resolve=>resolve(7)}})',
  'new Proxy({}, {get(t,k){if(k==="then")throw new RangeError("read")}})',
  '(()=>{const r=Proxy.revocable({},{});r.revoke();return r.proxy})()',
  'new Proxy({}, {get(){return undefined}})'
])("matches native Promise prototype Proxy adoption: %s", async proxy => {
  const source = `const p=Promise.resolve(1);let settle;const wrapped=new Promise(resolve=>{settle=resolve});
    const descriptor=Object.getOwnPropertyDescriptor(Promise.prototype,"then");
    const prototype=Object.getPrototypeOf(Promise.prototype);
    delete Promise.prototype.then;Object.setPrototypeOf(Promise.prototype,${proxy});
    settle(p);Object.setPrototypeOf(Promise.prototype,prototype);
    Object.defineProperty(Promise.prototype,"then",descriptor);
    try{const value=await wrapped;return value===p?"identity":value}catch(e){return e instanceof TypeError?e.name:[e.name,e.message]}`;
  const expected = await new Promise((resolve, reject) => {
    runInNewContext(`const then=Promise.prototype.then;then.call((async()=>{${source}})(),resolve,reject)`, { resolve, reject });
  });
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

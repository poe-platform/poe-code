import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createProxyGlobal } from "./proxy.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { measureSandboxData, type SandboxClosure, type SandboxObject } from "../values.js";

it.each([
  'return [Proxy.name,Proxy.length,Reflect.ownKeys(Proxy),Object.getPrototypeOf(Proxy)===Function.prototype]',
  'return [Proxy.revocable.name,Proxy.revocable.length,Object.getOwnPropertyDescriptor(Proxy,"revocable")]',
  'const r=Proxy.revocable({},{});return [Object.keys(r),r.revoke.name,r.revoke.length,Object.hasOwn(r.revoke,"prototype")]',
  'const r=Proxy.revocable({x:1},{});const revoke=r.revoke;const first=r.proxy.x;const a=revoke.call({});const b=revoke();try{return r.proxy.x}catch(e){return [first,a,b,e.name]}',
  'const p=new Proxy(x=>x+1,{});return p(2)',
  'const r=Proxy.revocable(function C(x){this.x=x},{});const value=new r.proxy(3);r.revoke();try{new r.proxy()}catch(e){return [value.x,typeof r.proxy,e.name]}',
  'try{class C extends Proxy{}return C}catch(e){return e.name}',
  'function N(){}const target={x:1};const p=Reflect.construct(Proxy,[target,{}],N);return [p.x,Object.getPrototypeOf(p)===Object.getPrototypeOf(target)]'
])("exposes Proxy globals: %s", async source => {
  // Compare serializable observations; descriptor values include functions.
  const observed = `const result=(function(){${source}})();return JSON.stringify(result)`;
  expect(await run(observed)).toMatchObject({ ok: true, returnValue: new Function(observed)() });
});

it("releases the revoker's private Proxy reference after revocation", async () => {
  const budget = new Budget(), constructor = createProxyGlobal(budget);
  const pair = await invokeBuiltinClosure(constructor.properties!.revocable as SandboxClosure,
    [{ text: 'x'.repeat(1000) }, {}], budget, undefined, undefined) as SandboxObject;
  const revoke = pair.revoke as SandboxClosure;
  const before = measureSandboxData([revoke]);
  await invokeBuiltinClosure(revoke, [], budget, undefined, undefined);
  const after = measureSandboxData([revoke]);
  expect(before - after).toBeGreaterThan(1000);
  await invokeBuiltinClosure(revoke, [], budget, undefined, undefined);
  expect(measureSandboxData([revoke])).toBe(after);
});

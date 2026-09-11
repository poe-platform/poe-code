import { expect, it } from "vitest";
import { run } from "../run.js";
import { cloneSandboxValue } from "./values.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";

it.each([false, true])("rejects Proxy cloning without a guest execution context (revoked: %s)", revoked => {
  const proxy = createGuestProxy({}, {});
  if (revoked) revokeGuestProxy(proxy);
  expect(() => cloneSandboxValue({proxy}, {structuredClone: true})).toThrow(expect.objectContaining({name: "DataCloneError"}));
});

it.each([
  'new Proxy({},{})',
  'new Proxy([],{})',
  'new Proxy(function(){},{})',
  'new Proxy(new Proxy({},{}),{})',
  '[new Proxy({},{})]',
  'new Map([[new Proxy({},{}),1]])',
  'new Set([new Proxy({},{})])',
  '{get value(){return new Proxy({},{})}}',
  '(function(){const r=Proxy.revocable({},{});r.revoke();return r.proxy})()'
])("rejects Proxy cloning before detaching transfers: %s", async value => {
  const source = `const buffer=new ArrayBuffer(1);try{structuredClone(${value},{transfer:[buffer]});return "accepted"}catch(e){return [e.name,e.code,buffer.byteLength]}`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
});

it("rejects Proxies without invoking traps or later getters", async () => {
  const source = `const events=[];const p=new Proxy({}, {
    get(){events.push("get")},ownKeys(){events.push("keys");return []},
    getPrototypeOf(){events.push("prototype");return null}
  });try{structuredClone({first:p,get later(){events.push("later");return 1}})}catch(e){events.push(e.name)}return events`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
});

import { expect, it } from "vitest";
import { createRealm, defineExtension, deepCopyFromSandbox, run } from "./index.js";

it.each([
  'return new Proxy({x:1},{})',
  'return new Proxy([1,2],{})',
  'return {nested:new Proxy({x:1},{})}',
  'return new Map([["proxy",new Proxy({x:1},{})]])',
  'return new Set([new Proxy({x:1},{})])',
  'const r=Proxy.revocable({},{});r.revoke();return r.proxy'
])("does not silently copy a guest Proxy as empty data: %s", async source => {
  const result = await run(source);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected successful guest execution");
  expect(() => deepCopyFromSandbox(result.returnValue)).toThrow("Proxy values require their owning realm bridge");
});

it("keeps explicit callable wrappers available", async () => {
  const result = await run('return new Proxy(()=>7,{})');
  if (!result.ok) throw new Error("Expected successful guest execution");
  let received: unknown;
  const wrapper = () => 7;
  expect(deepCopyFromSandbox(result.returnValue, { wrapClosure(value) {
    received = value;
    return wrapper;
  } })).toBe(wrapper);
  expect(received).toBe(result.returnValue);
});

it("preserves Proxy identity and traps through retained guest arguments", async () => {
  let retained: unknown;
  const extension = defineExtension({
    manifest: { version: 1, name: "proxy-reference", capabilities: ["guest:retain"], globals: ["save", "read"] },
    setup(context) {
      return { globals: {
        save: context.retainGuestArguments(value => { retained = value; }, 0),
        read: () => retained
      } };
    }
  });
  const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
  try {
    expect(await realm.evaluate('const target={x:1};const events=[];const p=new Proxy(target,{get(t,k,r){events.push(k);return Reflect.get(t,k,r)*2}});save(p);target.x=4;return [read()===p,read().x,events]'))
      .toMatchObject({ ok: true, returnValue: [true, 8, ["x"]] });
  } finally {
    if (retained !== undefined) realm.releaseGuestReference(retained);
    await realm.close();
  }
});

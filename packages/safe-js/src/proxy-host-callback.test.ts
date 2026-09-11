import { expect, it } from "vitest";
import { run } from "./run.js";
import { createRealm } from "./realm.js";
import { dump } from "./dump.js";
import { restore } from "./restore.js";

it.each([
  'return await host(new Proxy(x=>x+1,{get apply(){return (t,r,args)=>Reflect.apply(t,r,args)*3}}))',
  'return await host(new Proxy(async x=>{await 0;return x+1},{}))',
  'const r=Proxy.revocable(()=>0,{});r.revoke();try{return await host(r.proxy)}catch(e){return e.name}',
  'return await host(new Proxy(x=>x+1,{}))',
  'return await host(new Proxy(x=>x+1,{apply(t,r,args){return Reflect.apply(t,r,args)*2}}))',
  'const events=[];const result=await host(new Proxy(x=>x+1,{apply(t,r,args){events.push([r===undefined,args[0]]);return Reflect.apply(t,r,args)}}));return [result,events]',
  'return await host(new Proxy(new Proxy(x=>x+1,{}),{}))',
  'try{return await host(new Proxy(()=>0,{apply(){throw new RangeError("trap")}}))}catch(e){return [e.name,e.message]}'
])("matches native host invocation of a Proxy callback: %s", async source => {
  const host = async (callback: unknown) => Reflect.apply(callback as (...args: unknown[]) => unknown, undefined, [4]);
  const expected = await new Function("host", `return (async()=>{${source}})()`)(host);
  expect(await run(source, { bindings: { host } })).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  'new Proxy(function(x){return this.y+x},{get apply(){return (t,r,args)=>Reflect.apply(t,r,args)*3}})',
  'new Proxy(function(x){return this.y+x},{})',
  'new Proxy(function(x){return this.y+x},{apply(t,r,args){return Reflect.apply(t,r,args)*2}})',
  'new Proxy(new Proxy(function(x){return this.y+x},{}),{})'
])("invokes retained realm Proxy callbacks with receivers: %s", async expression => {
  const native = new Function(`return ${expression}`)();
  const expected = Reflect.apply(native, { y: 3 }, [4]);
  const realm = createRealm();
  try {
    const result = await realm.evaluate(`return ${expression}`);
    if (!result.ok) throw new Error("Expected successful guest execution");
    expect(await realm.invokeCallback(result.returnValue, { thisValue: { y: 3 }, args: [4] })).toEqual(expected);
  } finally { await realm.close(); }
});

it("restores a Proxy callback before its host invocation", async () => {
  const source = 'const f=new Proxy(x=>x+1,{apply(t,r,args){return Reflect.apply(t,r,args)*2}});await 0;return await host(f)';
  const bindings = { host: async (callback: unknown) => Reflect.apply(callback as (...args: unknown[]) => unknown, undefined, [4]) };
  const pending = run(source, { bindings });
  const completed = pending.catch(error => error);
  try {
    const wire = JSON.parse(await dump(pending));
    expect(wire.pendingAwaits).toHaveLength(1);
    expect(Object.values(wire.heap).some(node => (node as { kind: string }).kind === "guest-proxy")).toBe(true);
    expect(await completed).toMatchObject({ ok: true, returnValue: 10 });
    expect(await run(source, { bindings, snapshot: restore(wire, { source }) }))
      .toMatchObject({ ok: true, returnValue: 10 });
  } finally { await completed; }
});

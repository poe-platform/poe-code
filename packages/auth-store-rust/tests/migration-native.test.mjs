import assert from "node:assert/strict";
import { test } from "node:test";
import * as own from "../dist/index.js";
process.env.TSX_DISABLE_CACHE="1";
const { tsImport } = await import("tsx/esm/api");
const reference=await tsImport("../../auth-store/src/index.ts",import.meta.url);
function memory(initial=null) {
  let value=initial;const calls=[];
  return {calls,async get(...args){calls.push(["get",...args]);return value;},async set(...args){calls.push(["set",...args]);value=args[0];},async delete(...args){calls.push(["delete",...args]);value=null;}};
}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
test("native migration preserves values, read-only behavior and exact storage calls",async()=> {
  for(const primaryValue of [null,"primary",""]) for(const legacyValue of [null,"legacy",""]) for(const operation of ["get","readOnly","set","delete"]) {
    let baseline;
    for(const factory of [reference,own]) {
      const primary=memory(primaryValue),legacy=memory(legacyValue);const store=new factory.MigratingSecretStore(primary,legacy);
      const result=operation==="readOnly" ? await store.get({readOnly:true}) : operation==="set" ? await store.set("new") : await store[operation]();
      const calls={primary:[...primary.calls],legacy:[...legacy.calls]};const value={result,calls,primary:await primary.get(),legacy:await legacy.get()};
      if(factory===reference)baseline=value;else assert.deepEqual(value,baseline);
    }
  }
  for(const value of ["poe","\ud800","", "id:child"]) assert.equal(own.key(value),reference.key(value));
});
test("mirrored mutations restore both snapshots after partial legacy failure and queue continues",async()=> {
  for(const operation of ["set","delete"]) for(const initial of [null,"old"]) for(const factory of [reference,own]) {
    const primary=memory(initial),legacy=memory(initial);const apply=legacy[operation];let fail=true;
    legacy[operation]=async(...args)=>{await apply(...args);if(fail){fail=false;throw new Error("legacy failure");}};
    const store=new factory.MigratingSecretStore(primary,legacy);
    await assert.rejects(store[operation]("new"),/legacy failure/);
    assert.equal(await primary.get(),initial);assert.equal(await legacy.get(),initial);
    await store.set("later");assert.equal(await primary.get(),"later");assert.equal(await legacy.get(),"later");
  }
});
test("serialized mutations retain write order under delayed legacy commits",async()=> {
  for(const factory of [reference,own]) {
    const primary=memory(),legacy=memory();const applied=deferred(),release=deferred();const write=legacy.set;
    legacy.set=async value=>{if(value==="first"){applied.resolve();await release.promise;}await write(value);};
    const store=new factory.MigratingSecretStore(primary,legacy);const first=store.set("first");await applied.promise;
    const second=store.set("second");release.resolve();await Promise.all([first,second]);
    assert.equal(await primary.get(),"second");assert.equal(await legacy.get(),"second");
  }
});
test("migration revalidation prevents resurrection and preserves newer primary writes",async()=> {
  for(const factory of [reference,own]) for(const mutation of ["set","delete"]) for(const readOnly of [false,true]) {
    const primary=memory(),legacy=memory("old");const captured=deferred(),release=deferred();const read=legacy.get;let initial=true;
    legacy.get=async()=>{const value=await read();if(initial){initial=false;captured.resolve();await release.promise;}return value;};
    const store=new factory.MigratingSecretStore(primary,legacy);const pending=store.get({readOnly});await captured.promise;
    await store[mutation]("new");release.resolve();assert.equal(await pending,"old");
    assert.equal(await primary.get(),mutation==="set" ? "new" : null);assert.equal(await legacy.get(),mutation==="set" ? "new" : null);
  }
});

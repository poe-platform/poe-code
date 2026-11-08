import { expect, it } from "vitest";
import { run } from "../run.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { measureSandboxData } from "./values.js";
import { wellKnownSymbols } from "./symbols.js";
import { createWeakCollection, setWeakEntry, weakCollectionStates } from "./weak-collection.js";

it.each(["iterator", "dispose", "asyncDispose"])("supports Symbol.%s weak collection insertion, update and deletion", async name => {
  expect(await run(`const key=Symbol.${name};
    const map=new WeakMap([[key,7]]),set=new WeakSet([key]);
    map.set(key,9);set.add(key);
    return [map.get(key),set.has(key),map.delete(key),set.delete(key),map.has(key),set.has(key)]`))
    .toMatchObject({ok:true,returnValue:[9,true,true,true,false,false]});
});

it.each(["iterator", "dispose", "asyncDispose"])("charges values behind implicitly reachable Symbol.%s keys", name => {
  const map = createWeakCollection("map");
  setWeakEntry(map,wellKnownSymbols[name],"x".repeat(512));
  expect(measureSandboxData([map])).toBeGreaterThanOrEqual(514);
});

it.each(["iterator", "dispose", "asyncDispose"])("restores Symbol.%s entries without an explicit key root", name => {
  const source = "return 0";
  const map = createWeakCollection("map");
  setWeakEntry(map,wellKnownSymbols[name],"held-value");
  const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{map}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored = restore(JSON.parse(JSON.stringify(saved)),{source});
  const state = weakCollectionStates.get(restored.currentScope.lookup("map").value as object)!;
  expect(state.entries.get(wellKnownSymbols[name])?.value).toBe("held-value");
});

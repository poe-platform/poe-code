import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";
import { validateDumpEnvelope } from "./validation.js";

import { createWeakCollection, setWeakEntry, weakCollectionStates } from "../interp/weak-collection.js";
import { createWeakReferenceState, weakReferenceStates } from "../interp/weak-reference.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

it.each(['object', 'symbol'] as const)("closes rooted %s ephemerons and preserves weak aliases in dump graphs", kind => {
  const key = kind === 'object' ? {} : Symbol('key');
  const next = kind === 'object' ? {} : Symbol('next');
  const first = createWeakCollection('map'), second = createWeakCollection('map');
  const ref = Object.create(null);
  weakReferenceStates.set(ref, createWeakReferenceState(next));
  setWeakEntry(first, key, next);
  setWeakEntry(second, next, 'kept');
  const source = 'return 0';
  const wire = JSON.parse(serializeSafeJSSnapshot({sourceHash:'test',bindings:{second,ref,first,holder:kind === 'symbol' ? {[key as symbol]:true} : {key}}}));
  const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  saved.heap = wire.heap;
  saved.scopeChain[0]!.bindings = wire.bindings;
  const result = restore(saved,{source});
  const holder = result.currentScope.lookup('holder').value as Record<string | symbol, object | symbol>;
  const restoredKey = kind === 'symbol' ? Object.getOwnPropertySymbols(holder)[0]! : holder.key!;
  const a = weakCollectionStates.get(result.currentScope.lookup('first').value as object)!;
  const b = weakCollectionStates.get(result.currentScope.lookup('second').value as object)!;
  const restoredNext = a.entries.get(restoredKey)!.value as object | symbol;
  expect(b.entries.get(restoredNext)?.value).toBe('kept');
  expect(weakReferenceStates.get(result.currentScope.lookup('ref').value as object)?.deref()).toBe(restoredNext);
});

it("does not promote weak-only cycles into dump roots", () => {
  const a = {}, b = {};
  const first = createWeakCollection('map'), second = createWeakCollection('map');
  setWeakEntry(first,a,{b,secret:'weak-only-first'});
  setWeakEntry(second,b,{a,secret:'weak-only-second'});
  const ref = Object.create(null);
  weakReferenceStates.set(ref,createWeakReferenceState(a));
  const wire = serializeSafeJSSnapshot({sourceHash:'test',bindings:{first,second,ref}});
  expect(wire).not.toContain('weak-only');
  const nodes = Object.values(JSON.parse(wire).heap) as Array<{kind:string;entries?:unknown[];target?:unknown}>;
  for (const node of nodes.filter(node => node.kind === 'guest-weakcollection')) expect(node.entries).toEqual([]);
  expect(nodes.find(node => node.kind === 'guest-weakref')?.target).toEqual({kind:'undefined'});
});

it("preserves weak entries, targets and registry tokens in the public dump", async () => {
  const source = `const key={};const next={};const token={};const first=new WeakMap([[key,next]]);
    const second=new WeakMap([[next,7]]);const set=new WeakSet([next]);const ref=new WeakRef(next);
    const registry=new FinalizationRegistry(()=>{});registry.register(next,{key},token);
    Number.prototype.saved={first,second,set,ref,registry,key,token};await 0;return 1`;
  const pending = run(source);
  const snapshot = JSON.parse(await dump(pending));
  await pending;
  const nodes = Object.values(snapshot.heap) as Array<{kind: string; entries: unknown[]; target?: {kind: string}; cells: Array<{target: {kind: string}; token: {kind: string}}>}>;
  const maps = nodes.filter(node => node.kind === 'guest-weakcollection');
  expect(maps).toHaveLength(3);
  for (const node of maps) expect(node.entries).toHaveLength(1);
  expect(nodes.find(node => node.kind === 'guest-weakref')?.target?.kind).toBe('ref');
  const registry = nodes.find(node => node.kind === 'guest-finalization-registry')!;
  expect(registry.cells[0].target.kind).toBe('ref');
  expect(registry.cells[0].token.kind).toBe('ref');
  expect(() => validateDumpEnvelope(snapshot, {source})).not.toThrow();
  expect(() => restoreDump(snapshot,{source})).not.toThrow();
});

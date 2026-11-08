import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore as restoreRuntime } from "../snapshot/restore.js";
import { validateGuestHeapNode } from "../snapshot/guest-heap-validation.js";

const exports = { x: 1, z: 2, "10": 10, "2": 2 };
const nativeNamespaceUrl: string = "data:text/javascript,export const x=1,z=2;const ten=10,two=2;export {ten as '10',two as '2'}";
const nativeNamespace = await import(nativeNamespaceUrl);

it.each([
  ["shape", "return [Object.getPrototypeOf(ns),Object.isExtensible(ns),Object.isSealed(ns),Object.isFrozen(ns),Object.prototype.toString.call(ns)]"],
  ["export descriptors", "return Object.getOwnPropertyDescriptor(ns,'x')"],
  ["set rejection", "return [Reflect.set(ns,'x',7),Reflect.set(ns,'missing',7),ns.x,Reflect.has(ns,'missing')]"],
  ["strict assignment rejection", "try{ns.x=7;return 'accepted'}catch(e){return [e.name,ns.x]}"],
  ["deletion", "return [Reflect.deleteProperty(ns,'x'),Reflect.deleteProperty(ns,'missing'),Reflect.has(ns,'x')]"],
  ["compatible definitions", "return [Reflect.defineProperty(ns,'x',{value:1}),Reflect.defineProperty(ns,'x',{value:7}),Reflect.defineProperty(ns,'x',{writable:false}),Reflect.defineProperty(ns,'x',{configurable:true})]"],
  ["immutable prototype", "return [Reflect.setPrototypeOf(ns,null),Reflect.setPrototypeOf(ns,{})]"],
  ["assignment even with the same value", "try{Object.assign(ns,{x:1});return 'accepted'}catch(e){return e.name}"],
])("preserves module namespace %s", async (_name, source) => {
  const result = await run('import * as ns from "api";'+source,{modules:{api:exports}});
  assert(result.ok);
  expect(result.returnValue).toEqual(Function("ns", "'use strict';"+source)(nativeNamespace));
});

// Node 22/24 currently reorder integer-like export names and allow inherited
// namespace writes. These expectations follow ModuleNamespaceCreate/[[Set]].
it("orders namespace exports lexicographically, including integer-like names", async () => {
  const result = await run('import * as ns from "api";return Reflect.ownKeys(ns).map(String)',{modules:{api:exports}});
  assert(result.ok);
  expect(result.returnValue).toEqual(["10","2","x","z","Symbol(Symbol.toStringTag)"]);
});

it("rejects writes through an inherited namespace even for missing exports", async () => {
  const result = await run('import * as ns from "api";const target=Object.create(ns);const receiver={};return [Reflect.set(target,"missing",7,receiver),Reflect.ownKeys(receiver)]',{modules:{api:exports}});
  assert(result.ok);
  expect(result.returnValue).toEqual([false,[]]);
});

it("preserves namespace semantics and shared export data through public replay", async () => {
  const source = 'import * as first from "api";import * as second from "api";import {data} from "api";await 0;data.count++;return [first===second,first.data===data,first.data.count,Reflect.set(first,"data",{}),Object.isExtensible(first),Object.prototype.toString.call(first)]';
  const result = await run(source,{modules:{api:{data:{count:0}}}});
  assert(result.ok);
  expect(result.returnValue).toEqual([true,true,1,false,false,"[object Module]"]);
  const saved = restore(JSON.parse(await dump(result)),{source});
  const resumed = await run(source,{snapshot:saved});
  assert(resumed.ok);
  expect(resumed.returnValue).toEqual(result.returnValue);
});

it("returns namespace objects through the SDK without losing their behavior", async () => {
  const result = await run('import * as ns from "api";return ns',{modules:{api:exports}});
  assert(result.ok);
  const namespace = result.returnValue as object;
  expect(Object.getPrototypeOf(namespace)).toBeNull();
  expect(Reflect.ownKeys(namespace).map(String)).toEqual(["10","2","x","z","Symbol(Symbol.toStringTag)"]);
  expect(Reflect.set(namespace,"x",2)).toBe(false);
  expect(Reflect.defineProperty(namespace,"x",{value:1})).toBe(true);
  expect(Reflect.defineProperty(namespace,"x",{value:2})).toBe(false);
});

it("preserves namespace identity and cycles through low-level snapshots", async () => {
  const source = 'import * as ns from "api";ns.data.namespace=ns;return ns';
  const result = await run(source,{modules:{api:{data:{}}}});
  assert(result.ok);
  const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{ns:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const binding = restoreRuntime(JSON.parse(JSON.stringify(snapshot)),{source}).currentScope.lookup("ns");
  assert(binding.found);
  const namespace = binding.value as Record<string, {namespace: unknown}>;
  expect(namespace.data!.namespace).toBe(namespace);
  expect(Reflect.set(namespace,"missing",7)).toBe(false);
  expect(Object.prototype.toString.call(namespace)).toBe("[object Module]");
});

it("rejects structured cloning a module namespace", async () => {
  const result = await run('import * as ns from "api";try{structuredClone(ns);return "accepted"}catch(e){return e.name}',{modules:{api:exports}});
  assert(result.ok);
  expect(result.returnValue).toBe("DataCloneError");
});

it("preserves empty and prototype-sensitive export names", async () => {
  const modules = {api:Object.fromEntries([["",1],["__proto__",2],["constructor",3]])};
  const result = await run('import * as ns from "api";return [Reflect.ownKeys(ns).map(String),ns[""],ns.__proto__,ns.constructor,Object.getPrototypeOf(ns)]',{modules});
  assert(result.ok);
  expect(result.returnValue).toEqual([["","__proto__","constructor","Symbol(Symbol.toStringTag)"],1,2,3,null]);
});

it.each([
  {kind:"module-namespace",entries:[["x",1],["x",2]]},
  {kind:"module-namespace",entries:[[1,2]]},
  {kind:"module-namespace",entries:[["x"]]},
  {kind:"module-namespace",entries:[],prototype:{}},
])("rejects malformed namespace heap nodes %#", node => {
  expect(() => validateGuestHeapNode(node,{})).toThrow();
});

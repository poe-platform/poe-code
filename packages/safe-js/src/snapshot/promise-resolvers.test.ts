import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ["const {promise,resolve,reject}=Promise.withResolvers();resolve(7);await promise;const bound=resolve.bind(null,9);return async()=>{bound();return await promise}", 7],
  ["const {promise,resolve,reject}=Promise.withResolvers();resolve(7);await promise;resolve.self=resolve;resolve.other=reject;return ()=>[resolve.self===resolve,resolve.other===reject]", [true,true]],
  ["const {promise,resolve,reject}=Promise.withResolvers();resolve(7);await promise;let reads=0;const value={get then(){reads++;throw 'unexpected'}};return async()=>{resolve(value);reject(value);return [await promise,reads]}", [7,0]],
  ["const {promise,resolve,reject}=Promise.withResolvers();resolve(7);await promise;return async()=>{resolve(9);reject('late');return await promise}", 7],
  ["const {promise,resolve,reject}=Promise.withResolvers();reject('first');try{await promise}catch{}return async()=>{resolve(9);reject('late');try{await promise}catch(e){return e}}", "first"],
  ["const {promise,resolve,reject}=Promise.withResolvers();resolve(7);await promise;resolve.label=9;return ()=>[resolve.length,resolve.name,resolve.label,resolve===resolve,reject!==resolve]", [1,"",9,true,true]]
] as const)("restores retained resolving functions after settlement: %s", async (source, expected) => {
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source,budget}).currentScope.lookup("read");
  assert(binding.found && isSandboxClosure(binding.value));
  const value = await invokeBuiltinClosure(binding.value, [], budget, undefined, undefined);
  expect(await awaitSandboxValue(value, undefined, budget)).toEqual(expected);
});

it.each(["wrong-target", "pending-target"])("rejects malformed resolver snapshots: %s", async mutation => {
  const source = "const {promise,resolve}=Promise.withResolvers();resolve(7);await promise;return ()=>resolve";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  assert(snapshot.heap !== undefined);
  const entry = Object.entries(snapshot.heap).find(([,node]) => node.kind === "promise-resolver");
  assert(entry !== undefined && entry[1].kind === "promise-resolver");
  if (mutation === "wrong-target") entry[1].promise = {kind: "ref", id: Number(entry[0])};
  else {
    const reference = entry[1].promise;
    assert(reference !== null && typeof reference === "object" && "kind" in reference && reference.kind === "ref");
    Object.assign(snapshot.heap[String(reference.id)], {status: "pending"});
  }
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source,budget: new Budget()})).toThrow();
});

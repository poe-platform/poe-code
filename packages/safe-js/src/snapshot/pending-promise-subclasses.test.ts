import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ["class P extends Promise{#label=9;read(){return this.#label}}const c=P.withResolvers();const chained=c.promise.then(value=>value+1);return async()=>{c.resolve(7);return [await chained,chained instanceof P,chained.read()]}", [8,true,9]],
  ["class P extends Promise{}const c=Promise.withResolvers();c.promise.constructor={[Symbol.species]:P};const chained=c.promise.then(undefined,reason=>'handled:'+reason);return async()=>{c.reject('reason');return [await chained,chained instanceof P]}", ["handled:reason",true]],
  ["let constructors=0;class P extends Promise{constructor(executor){constructors++;super(executor)}}const c=Promise.withResolvers();c.promise.constructor={[Symbol.species]:P};const chained=c.promise.then(value=>value+1);return async()=>{const before=constructors;c.resolve(7);return [before,await chained]}", [1,8]],
  ["let settleResult;let calls=0;class P extends Promise{constructor(executor){super((resolve,reject)=>{settleResult=resolve;executor(resolve,reject)})}}const c=Promise.withResolvers();c.promise.constructor={[Symbol.species]:P};const chained=c.promise.then(()=>{calls++;return 7});settleResult(99);await chained;return async()=>{c.resolve(7);await c.promise;await 0;return [await chained,calls]}", [99,1]]
] as const)("restores pending subclass reactions: %s", async (source, expected) => {
  const control = await run(source);
  assert(control.ok && isSandboxClosure(control.returnValue));
  const controlBudget = new Budget();
  const controlValue = await invokeBuiltinClosure(control.returnValue, [], controlBudget, undefined, undefined);
  expect(await awaitSandboxValue(controlValue, undefined, controlBudget)).toEqual(expected);

  const fresh = await run(source);
  assert(fresh.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: fresh.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const budget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source,budget}).currentScope.lookup("read");
  assert(binding.found && isSandboxClosure(binding.value));
  const value = await invokeBuiltinClosure(binding.value, [], budget, undefined, undefined);
  expect(await awaitSandboxValue(value, undefined, budget)).toEqual(expected);
});

it("rejects a producer substituted as its own result", async () => {
  const source = "class P extends Promise{}const c=P.withResolvers();const result=c.promise.then(value=>value);return ()=>[c,result]";
  const fresh = await run(source);
  assert(fresh.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: fresh.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  assert(snapshot.heap !== undefined);
  const entry = Object.entries(snapshot.heap).find(([,node]) => node.kind === "promise-reaction" && node.capability !== undefined);
  assert(entry !== undefined && entry[1].kind === "promise-reaction" && entry[1].capability !== undefined);
  const [id, producer] = entry;
  assert(producer.kind === "promise-reaction" && producer.capability !== undefined);
  for (const node of Object.values(snapshot.heap)) {
    if (node.kind === "pending-promise" || node.kind === "guest-promise" || node.kind === "promise-reaction") delete node.producers;
  }
  producer.capability.promise = {kind: "ref", id: Number(id)};
  producer.producers = [{kind: "ref", id: Number(id)}];
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()}))
    .toThrow("Invalid promise producer ownership");
});

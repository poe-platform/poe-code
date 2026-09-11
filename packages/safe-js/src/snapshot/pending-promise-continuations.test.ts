import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ["const {promise,resolve}=Promise.withResolvers();return async()=>{resolve(7);return await promise}", 7],
  ["const {promise,reject}=Promise.withResolvers();return async()=>{reject('reason');try{await promise}catch(error){return error}}", "reason"],
  ["const {promise,resolve}=Promise.withResolvers();const chained=promise.then(value=>value+1);return async()=>{resolve(7);return await chained}", 8],
  ["const first=Promise.withResolvers();const second=Promise.withResolvers();first.resolve(second.promise);return async()=>{first.resolve(99);second.resolve(7);return await first.promise}", 7],
  ["const first=Promise.withResolvers();const second=Promise.withResolvers();first.resolve(second.promise);return async()=>{first.reject('late');second.reject('reason');try{return await first.promise}catch(error){return error}}", "reason"],
  ["const first=Promise.withResolvers();const second=Promise.withResolvers();const third=Promise.withResolvers();first.resolve(second.promise);second.resolve(third.promise);return async()=>{third.resolve(7);return await first.promise}", 7],
  ["const first=Promise.withResolvers();const second=Promise.withResolvers();first.resolve(second.promise);return async()=>{let reads=0;second.resolve({get then(){reads++;return resolve=>resolve(7)}});return [await first.promise,reads]}", [7,1]],
  ["const c=Promise.withResolvers();let value=0;c.promise.then(()=>{value=9});return async()=>{c.resolve(7);await c.promise;await 0;return value}", 9],
  ["let second,first,c;const order=[];c=Promise.withResolvers();first=c.promise.then(()=>{order.push('first')});second=c.promise.then(()=>{order.push('second')});return async()=>{c.resolve(7);await first;await second;return order}", ["first", "second"]],
  ["const c=Promise.withResolvers();const chained=c.promise.then(undefined,reason=>'handled:'+reason);return async()=>{c.reject('reason');return await chained}", "handled:reason"],
  ["const c=Promise.withResolvers();const chained=c.promise.then();return async()=>{c.resolve(7);return await chained}", 7],
  ["const c=Promise.withResolvers();const chained=c.promise.then(()=>{throw 'failure'});return async()=>{c.resolve(7);try{await chained}catch(error){return error}}", "failure"]
] as const)("restores a pending promise continuation: %s", async (source, expected) => {
  const control = await run(source);
  assert(control.ok && isSandboxClosure(control.returnValue));
  const controlBudget = new Budget();
  const controlValue = await invokeBuiltinClosure(control.returnValue, [], controlBudget, undefined, undefined);
  expect(await awaitSandboxValue(controlValue, undefined, controlBudget)).toEqual(expected);

  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const budget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget}).currentScope.lookup("read");
  assert(binding.found && isSandboxClosure(binding.value));
  const value = await invokeBuiltinClosure(binding.value, [], budget, undefined, undefined);
  expect(await awaitSandboxValue(value, undefined, budget)).toEqual(expected);
});

it.each(["missing-callbacks", "wrong-action"])("rejects incomplete adoption bridges: %s", async mutation => {
  const source = "const first=Promise.withResolvers();const second=Promise.withResolvers();first.resolve(second.promise);return ()=>[first,second]";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  assert(snapshot.heap !== undefined);
  const reaction = Object.values(snapshot.heap).find(node => node.kind === "promise-reaction");
  assert(reaction?.kind === "promise-reaction");
  if (mutation === "missing-callbacks") {
    reaction.onFulfilled = {kind: "undefined"};
    reaction.onRejected = {kind: "undefined"};
  } else {
    const resolver = Object.values(snapshot.heap).find(node => node.kind === "adoption-resolver" && node.action === "fulfilled");
    assert(resolver?.kind === "adoption-resolver");
    resolver.action = "rejected";
  }
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()}))
    .toThrow("Invalid promise adoption callbacks");
});

it.each([1, 2])("rejects a cyclic graph of %i promise reactions", async count => {
  const source = "const c=Promise.withResolvers();const first=c.promise.then(value=>value);const second=first.then(value=>value);return ()=>[c,first,second]";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  assert(snapshot.heap !== undefined);
  const reactions = Object.entries(snapshot.heap).filter(([,node]) => node.kind === "promise-reaction");
  expect(reactions).toHaveLength(2);
  const cycle = reactions.slice(0, count);
  for (const node of Object.values(snapshot.heap)) {
    if (node.kind === "pending-promise" || node.kind === "promise-reaction") node.reactions = [];
  }
  for (let index = 0; index < cycle.length; index++) {
    const [id, node] = cycle[index]!;
    const [sourceId, sourceNode] = cycle[(index + 1) % cycle.length]!;
    assert(node.kind === "promise-reaction" && sourceNode.kind === "promise-reaction");
    node.source = {kind: "ref", id: Number(sourceId)};
    sourceNode.reactions.push({kind: "ref", id: Number(id)});
  }
  if (count === 1) {
    const [id, node] = reactions[1]!;
    const [sourceId, sourceNode] = cycle[0]!;
    assert(node.kind === "promise-reaction" && sourceNode.kind === "promise-reaction");
    node.source = {kind: "ref", id: Number(sourceId)};
    sourceNode.reactions.push({kind: "ref", id: Number(id)});
  }
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()}))
    .toThrow("Cyclic promise reaction source graph");
});

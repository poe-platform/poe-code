import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { dump } from "../dump.js";
import { validateDumpEnvelope } from "./validation.js";
import { restore as restoreExecution } from "../restore.js";

it("saves and resumes a live run around thenable scheduling", async () => {
  const source = "let finish;let calls=0;const p=Promise.resolve({then(resolve){calls++;finish=resolve}});await 0;finish(7);return [await p,calls]";
  const first = run(source);
  try {
    const snapshot = JSON.parse(await dump(first));
    expect(await first).toMatchObject({ok: true, returnValue: [7, 1]});
    expect(await run(source, {snapshot: restoreExecution(snapshot, {source})})).toMatchObject({ok: true, returnValue: [7, 1]});
  } finally { await first; }
});

it("rejects a pending thenable whose owner no longer links back to it", async () => {
  const source = "let finish;const p=Promise.resolve({then(resolve){finish=resolve}});await 0;return ()=>[finish,p]";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  assert(snapshot.heap !== undefined);
  const owner = Object.values(snapshot.heap).find(node => node.kind === "pending-promise" && node.thenable !== undefined);
  assert(owner?.kind === "pending-promise");
  delete owner.thenable;
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()})).toThrow("Invalid thenable");
});

it.each(["direct", "nested"])("rejects internal thenable state in %s guest data", async location => {
  const pending = run("let finish;const p=Promise.resolve({then(resolve){finish=resolve}});await 0;return ()=>[finish,p]");
  try {
    await pending;
    const snapshot = JSON.parse(await dump(pending));
    const entry = Object.entries(snapshot.heap as Record<string, {kind: string}>).find(([, node]) => node.kind === "thenable-state");
    assert(entry !== undefined);
    const reference = {kind: "ref", id: Number(entry[0])};
    snapshot.bindings.leak = location === "direct" ? reference : [{nested: reference}];
    expect(() => validateDumpEnvelope(snapshot)).toThrow("Internal thenable states cannot be guest data");
  } finally { await pending; }
});

it.each(["resolve", "reject"])("restores a completed thenable invocation awaiting %s", async action => {
  const source = `let finish;let calls=0;const promise=Promise.resolve({then(resolve,reject){calls++;finish=${action}}});await 0;return async()=>{finish(7);try{return [await promise,calls,"fulfilled"]}catch(reason){return [reason,calls,"rejected"]}}`;
  const nativeRead = await new Function(`return (async()=>{${source}})()`)();
  const expected = await nativeRead();
  expect(expected).toEqual([7, 1, action === "resolve" ? "fulfilled" : "rejected"]);
  const control = await run(source);
  assert(control.ok && isSandboxClosure(control.returnValue));
  const controlBudget = new Budget();
  expect(await awaitSandboxValue(await invokeBuiltinClosure(control.returnValue, [], controlBudget, undefined, undefined), undefined, controlBudget)).toEqual(expected);
  const fresh = await run(source);
  assert(fresh.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: fresh.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const budget = new Budget();
  const read = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget}).currentScope.lookup("read");
  assert(read.found && isSandboxClosure(read.value));
  expect(await awaitSandboxValue(await invokeBuiltinClosure(read.value, [], budget, undefined, undefined), undefined, budget)).toEqual(expected);
});

it.each([
  "let finish;let reads=0,calls=0;const p=Promise.resolve({get then(){reads++;return resolve=>{calls++;finish=resolve}}});await 0;const bound=finish.bind(null,7);return async()=>{bound();return [await p,reads,calls,finish.name,finish.length]}",
  "let finish;const p=Promise.resolve({then(resolve){finish=resolve}});await 0;const target={};Object.defineProperty(target,'value',{set:finish});return async()=>{target.value=7;return await p}",
  "let first,second;let calls=0;const p=Promise.resolve({then(resolve){calls++;first=resolve}});await 0;first({then(resolve){calls++;second=resolve}});await 0;return async()=>{first(99);second(7);return [await p,calls]}",
  "let finish;let calls=0;const p=Promise.resolve({then(resolve){calls++;finish=resolve;resolve(7);throw 9}});await p;return async()=>{finish(99);return [await p,calls]}"
])("preserves native thenable side effects and callback use: %s", async source => {
  const nativeRead = await new Function(`return (async()=>{${source}})()`)();
  const expected = await nativeRead();
  const control = await run(source);
  assert(control.ok && isSandboxClosure(control.returnValue));
  const controlBudget = new Budget();
  expect(await awaitSandboxValue(await invokeBuiltinClosure(control.returnValue, [], controlBudget, undefined, undefined), undefined, controlBudget)).toEqual(expected);
  const fresh = await run(source);
  assert(fresh.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: fresh.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const budget = new Budget();
  const read = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget}).currentScope.lookup("read");
  assert(read.found && isSandboxClosure(read.value));
  expect(await awaitSandboxValue(await invokeBuiltinClosure(read.value, [], budget, undefined, undefined), undefined, budget)).toEqual(expected);
});

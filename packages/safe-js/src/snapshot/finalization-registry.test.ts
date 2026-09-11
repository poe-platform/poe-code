import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { FinalizationRegistryState, finalizationRegistryStates } from "../interp/finalization-registry-state.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { runResources, withRunResources } from "../interp/resources.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";
import { SandboxJobQueue } from "../interp/jobs.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import type { RuntimeSnapshotValue } from "./serialize.js";
import { Budget } from "../interp/budget.js";

it("finishes restore rollback when an owner cleanup detacher throws", async () => {
  const source = "return () => 0";
  const result = await run(source);
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing cleanup callback.");
  const registries = [Object.create(null), Object.create(null)];
  for (const registry of registries) {
    const state = new FinalizationRegistryState(async () => {}, () => {});
    finalizationRegistryStates.set(registry, {state, callback:result.returnValue});
    state.register(undefined, 7);
  }
  const saved = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{registries}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget = new Budget();
  const failure = new Error("reject restored heap");
  const detachFailure = new Error("detach failed");
  const detach = vi.fn(() => { throw detachFailure; });
  const reconcile = vi.spyOn(budget,"reconcileCompileData").mockImplementationOnce(() => {throw failure;});
  try {
    runResources.run({signal:new AbortController().signal,referenceReleases:new Set(),
      reportError:vi.fn(),add:() => detach}, () => {
      let caught: unknown;
      try { restore(JSON.parse(JSON.stringify(saved)), {source,budget}); }
      catch (error) { caught = error; }
      expect(detach).toHaveBeenCalledTimes(2);
      expect(caught).toBeInstanceOf(AggregateError);
      expect((caught as AggregateError).errors).toEqual([failure,detachFailure,detachFailure]);
      budget.reconcileDataUsage(0);
      expect(budget.currentDataSize).toBe(0);
      expect(() => budget.acquireCompileOwner(true).release()).not.toThrow();
    });
  } finally { reconcile.mockRestore(); }
});

it("does not dispatch cleanup when final heap budget reconciliation rejects restoration", async () => {
  const source = "return () => {throw 'cleanup ran after rejected restore'}";
  const result = await run(source);
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing cleanup callback.");
  const registry = Object.create(null);
  const state = new FinalizationRegistryState(async () => {}, () => {});
  finalizationRegistryStates.set(registry,{state,callback:result.returnValue});
  state.register(undefined,7);
  const saved = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{registry}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget = new Budget();
  const failure = new Error("reject final restored heap");
  const reconcile = vi.spyOn(budget,"reconcileCompileData").mockImplementationOnce(() => {throw failure;});
  try {
    await expect(withRunResources(undefined, async () => {
      const queue = new SandboxJobQueue();
      await queue.run(() => {
        expect(() => restore(JSON.parse(JSON.stringify(saved)),{source,budget})).toThrow(failure);
      });
      budget.reconcileDataUsage(0);
      expect(budget.currentDataSize).toBe(0);
      await queue.drain();
      return "restore rejected without cleanup";
    })).resolves.toBe("restore rejected without cleanup");
  } finally { reconcile.mockRestore(); }
});

it("delivers a collected target's held value to the restored guest cleanup callback", async () => {
  const source = "const values=[];return [value=>values.push(value),()=>values]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const [callback,reader] = result.returnValue as RuntimeSnapshotValue[];
  if (!isSandboxClosure(callback)) throw new Error("Missing cleanup callback.");
  const registry = Object.create(null);
  const state = new FinalizationRegistryState(async () => {}, () => {});
  finalizationRegistryStates.set(registry,{state,callback});
  state.register(undefined,7);
  const saved = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{registry,reader}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  await withRunResources(undefined, async () => {
    const queue = new SandboxJobQueue();
    const restored = await queue.run(() => restore(JSON.parse(JSON.stringify(saved)),{source}));
    await queue.drain();
    const read = restored.currentScope.lookup("reader").value;
    if (!isSandboxClosure(read)) throw new Error("Missing restored reader.");
    expect(await invokeBuiltinClosure(read,[],restored.budget,undefined,undefined)).toEqual([7]);
    expect(finalizationRegistryStates.get(restored.currentScope.lookup("registry").value as object)!.state.cells.size).toBe(0);
  });
});

it("validates a registry heap node and rejects malformed callbacks and weak edges", async () => {
  const source = "return () => 0";
  const result = await run(source);
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing cleanup callback.");
  const registry = Object.create(null);
  const state = new FinalizationRegistryState(async () => {}, () => {});
  finalizationRegistryStates.set(registry,{state,callback:result.returnValue});
  state.register(Symbol.iterator,"held",Symbol.dispose);
  const saved = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{registry}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const heap = saved.heap!;
  const node = Object.values(heap).find(value => value.kind === "guest-finalization-registry")!;
  expect(validateGuestHeapNode(node,heap)).toBe(true);
  for (const patch of [{callback:1},{callback:{kind:"undefined"}},{extra:true},
    {cells:[{target:null,token:{kind:"undefined"},heldValue:"held"}]},
    {cells:[{target:{kind:"undefined"},token:1,heldValue:"held"}]}]) {
    expect(() => validateGuestHeapNode({...node,...patch},heap)).toThrow();
  }
});

it("restores registry cells under a live execution owner", async () => {
  const source = "return () => 0";
  const result = await run(source);
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing cleanup callback.");
  const registry = Object.create(null);
  const state = new FinalizationRegistryState(async () => {}, () => {});
  finalizationRegistryStates.set(registry,{state,callback:result.returnValue});
  const target = {}, token = {};
  state.register(target,"held",token);
  const saved = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{registry,target,token}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  await withRunResources(undefined, async () => {
    const restored = restore(JSON.parse(JSON.stringify(saved)),{source});
    const entry = finalizationRegistryStates.get(restored.currentScope.lookup("registry").value as object);
    expect(entry).toBeDefined();
    expect(entry!.state.cells.size).toBe(1);
    expect(entry!.state.unregister(restored.currentScope.lookup("token").value as object)).toBe(true);
  });
});

it("serializes strong held values without making target and token edges strong", async () => {
  const source = "return () => 0";
  const result = await run(source);
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing cleanup callback.");
  const registry = Object.create(null);
  const state = new FinalizationRegistryState(async () => {}, () => {});
  finalizationRegistryStates.set(registry,{state,callback:result.returnValue});
  const target = {secret:"weak-target-only"}, token = {secret:"weak-token-only"};
  state.register(target,{payload:"strong-held-value"},token);
  const saved = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{registry}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const text = JSON.stringify(saved);
  expect(text).toContain("strong-held-value");
  expect(text).not.toContain("weak-target-only");
  expect(text).not.toContain("weak-token-only");
  expect(Object.values(saved.heap ?? {}).some(node => node.kind === "guest-finalization-registry")).toBe(true);
});

it("recognizes targets made strongly reachable through a held value", async () => {
  const source = "return () => 0";
  const result = await run(source);
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing cleanup callback.");
  const registry = Object.create(null);
  const state = new FinalizationRegistryState(async () => {}, () => {});
  finalizationRegistryStates.set(registry,{state,callback:result.returnValue});
  const target = {payload:"rooted-through-held-value"};
  state.register(target,{back:target},target);
  const saved = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{registry}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const node = Object.values(saved.heap ?? {}).find(value => value.kind === "guest-finalization-registry") as unknown as {
    cells: Array<{target:unknown;token:unknown;heldValue:unknown}>
  };
  expect(node).toBeDefined();
  expect(node.cells[0]!.target).toMatchObject({kind:"ref"});
  expect(node.cells[0]!.token).toEqual(node.cells[0]!.target);
  expect(JSON.stringify(saved)).toContain("rooted-through-held-value");
});

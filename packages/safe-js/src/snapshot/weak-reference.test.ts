import { expect, it } from "vitest";
import { createWeakReferenceState, weakReferenceStates } from "../interp/weak-reference.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";
import { run } from "../run.js";
import type { RuntimeSnapshotValue } from "./serialize.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { isSandboxClosure } from "../interp/values.js";

it.each([Symbol.iterator, Symbol.dispose, Symbol.asyncDispose])("preserves always-reachable well-known target %s without another scope root", target => {
  const reference = Object.create(null);
  weakReferenceStates.set(reference, createWeakReferenceState(target));
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { reference } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  expect(weakReferenceStates.get(restored.currentScope.lookup("reference").value as object)?.deref()).toBe(target);
});

it("restores public dereference methods, subclass identity and target aliases", async () => {
  const source = `class Derived extends WeakRef{};const target={value:7};const reference=new Derived(target);
    return ()=>[reference.deref()===target,reference.deref().value,reference instanceof Derived,
      reference instanceof WeakRef,Object.prototype.toString.call(reference)]`;
  const fresh = await run(source);
  if (!fresh.ok) throw fresh.error;
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { read: fresh.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const budget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(saved)), { source, budget }).currentScope.lookup("read");
  if (!isSandboxClosure(binding.value)) throw new Error("Missing restored reader.");
  expect(await invokeBuiltinClosure(binding.value, [], budget, undefined, undefined))
    .toEqual([true,7,true,true,"[object WeakRef]"]);
});

it("rejects a forged registered-symbol target before registry hydration", async () => {
  const result = await run("return [Symbol, Symbol.for('registered')]");
  if (!result.ok) throw result.error;
  const [constructor, target] = result.returnValue as RuntimeSnapshotValue[];
  const reference = Object.create(null);
  weakReferenceStates.set(reference, { deref: () => undefined });
  const source = "return 0";
  const saved = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { reference, target, Symbol: constructor } }],
    callStack: [], pendingPromises: [], moduleBindings: {} })));
  const node = Object.values(saved.heap).find(value => (value as {kind: string}).kind === "guest-weakref") as { target: unknown };
  node.target = saved.scopeChain[0].bindings.target;
  expect(() => restore(saved, { source })).toThrow();
});

it.each(["scope-frame", "construction-environment", "thenable-state", "guest-script", "promise-aggregate"])(
  "rejects internal %s records as weak targets before hydration", kind => {
    const reference = Object.create(null);
    weakReferenceStates.set(reference, { deref: () => undefined });
    const saved = serialize({ source: "return 0", currentAstNodeId: 1,
      scopeChain: [{ id: "module", bindings: { reference } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const heap = saved.heap! as Record<string, unknown>;
    const node = Object.values(heap).find(value => (value as {kind: string}).kind === "guest-weakref") as { target: unknown };
    heap["999999"] = { kind };
    node.target = { kind: "ref", id: 999999 };
    expect(() => validateGuestHeapNode(node, heap)).toThrow();
  }
);

it("preserves custom properties and a strongly rooted self-target", () => {
  const reference = Object.create(null);
  reference.self = reference;
  Object.defineProperty(reference, "label", { value: "kept", enumerable: false });
  weakReferenceStates.set(reference, new WeakRef(reference));
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { reference } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const result = restored.currentScope.lookup("reference").value as Record<string, unknown>;
  expect(result.self).toBe(result);
  expect(weakReferenceStates.get(result)?.deref()).toBe(result);
  expect(Object.getOwnPropertyDescriptor(result, "label")).toEqual({
    value: "kept", enumerable: false, configurable: false, writable: false
  });
});

it("does not let a weak-only back-reference cycle establish reachability", () => {
  const reference = Object.create(null);
  const target = { reference, secret: "weak-cycle-target" };
  weakReferenceStates.set(reference, new WeakRef(target));
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { reference } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  expect(JSON.stringify(saved)).not.toContain("weak-cycle-target");
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  expect(weakReferenceStates.get(restored.currentScope.lookup("reference").value as object)?.deref()).toBeUndefined();
});

it.each(["binding", "property"])("preserves a symbol target rooted by a %s", mode => {
  const target = Symbol("target");
  const reference = Object.create(null);
  weakReferenceStates.set(reference, Reflect.construct(WeakRef, [target]));
  const holder = mode === "binding" ? { target } : { [target]: true };
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { reference, holder } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const restoredHolder = restored.currentScope.lookup("holder").value as Record<string, unknown>;
  const restoredTarget = mode === "binding" ? restoredHolder.target : Object.getOwnPropertySymbols(restoredHolder)[0];
  expect(weakReferenceStates.get(restored.currentScope.lookup("reference").value as object)?.deref()).toBe(restoredTarget);
});

it.each([null, 1, "invalid", { kind: "ref", id: 999999 }])("rejects malformed weak target %j", target => {
  const reference = Object.create(null);
  weakReferenceStates.set(reference, { deref: () => undefined });
  const source = "return 0";
  const saved = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { reference } }],
    callStack: [], pendingPromises: [], moduleBindings: {} })));
  const node = Object.values(saved.heap).find(value => (value as {kind: string}).kind === "guest-weakref") as { target: unknown };
  node.target = target;
  expect(() => restore(saved, { source })).toThrow();
});

it("restores a WeakRef internal target when the target has a strong snapshot root", () => {
  const target = { value: 7 };
  const reference = Object.create(null);
  weakReferenceStates.set(reference, new WeakRef(target));
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { reference, target } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const restoredReference = restored.currentScope.lookup("reference").value as object;
  const restoredTarget = restored.currentScope.lookup("target").value;
  expect(weakReferenceStates.has(restoredReference)).toBe(true);
  expect(weakReferenceStates.get(restoredReference)?.deref()).toBe(restoredTarget);
});

it("does not promote a weak-only target into the snapshot root graph", () => {
  const target = { secret: "weak-only-target" };
  const reference = Object.create(null);
  weakReferenceStates.set(reference, new WeakRef(target));
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { reference } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  expect(JSON.stringify(saved)).not.toContain("weak-only-target");
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const restoredReference = restored.currentScope.lookup("reference").value as object;
  expect(weakReferenceStates.has(restoredReference)).toBe(true);
  expect(weakReferenceStates.get(restoredReference)?.deref()).toBeUndefined();
});

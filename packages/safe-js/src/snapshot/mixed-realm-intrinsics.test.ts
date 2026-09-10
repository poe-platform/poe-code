import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { isSandboxClosure } from "../interp/values.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { getSandboxPrototype } from "../interp/object-model.js";
import { Budget } from "../interp/budget.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

it.each(["Number", "Date", "Map"])("preserves distinct %s intrinsic graphs from two originating realms", async name => {
  const values = [];
  const native = [];
  for (const label of ["first", "second"]) {
    const source = `${name}.prototype.label=${JSON.stringify(label)};return [${name},${name}.prototype,Object.prototype]`;
    native.push(runInNewContext(`(function(){${source}})()`));
    const result = await run(source);
    if (!result.ok || !Array.isArray(result.returnValue)) throw new Error("Missing realm exports");
    values.push(result.returnValue);
  }
  expect(native[0][0] === native[1][0]).toBe(false);
  expect(native[0][1] === native[1][1]).toBe(false);
  expect(values[0][0] === values[1][0]).toBe(false);
  expect(values[0][1] === values[1][1]).toBe(false);
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { first: values[0], second: values[1], alias: values[0] } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const first = restored.currentScope.lookup("first").value;
  const second = restored.currentScope.lookup("second").value;
  if (!Array.isArray(first) || !Array.isArray(second)) throw new Error("Missing restored graphs");
  expect.soft(first[0] === second[0]).toBe(false);
  expect.soft(first[1] === second[1]).toBe(false);
  expect.soft(first[2] === second[2]).toBe(false);
  expect.soft((first[1] as Record<string, unknown>).label).toBe("first");
  expect.soft((second[1] as Record<string, unknown>).label).toBe("second");
  expect(restored.currentScope.lookup("alias").value === first).toBe(true);
  for (const graph of [first, second]) {
    if (!isSandboxClosure(graph[0])) throw new Error("Missing restored constructor");
    expect(graph[0].properties?.prototype === graph[1]).toBe(true);
    const instance = await invokeBuiltinClosure(graph[0], name === "Map" ? [] : [7], restored.budget, undefined, undefined, true);
    if (instance === null || typeof instance !== "object") throw new Error("Missing constructed instance");
    expect(getSandboxPrototype(instance, restored.budget) === graph[1]).toBe(true);
  }
  const again = restore(JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { first, second, alias: first } }],
    callStack: [], pendingPromises: [], moduleBindings: {} }))), { source });
  const againFirst = again.currentScope.lookup("first").value;
  const againSecond = again.currentScope.lookup("second").value;
  if (!Array.isArray(againFirst) || !Array.isArray(againSecond)) throw new Error("Missing recaptured graphs");
  expect(againFirst[0] === againSecond[0]).toBe(false);
  expect(againFirst[1] === againSecond[1]).toBe(false);
  expect((againFirst[1] as Record<string, unknown>).label).toBe("first");
  expect((againSecond[1] as Record<string, unknown>).label).toBe("second");
  expect(again.currentScope.lookup("alias").value === againFirst).toBe(true);
  const limited = new Budget();
  const failure = new Error("reject final mixed-realm reconciliation");
  const reconcile = vi.spyOn(limited, "reconcileCompileData").mockImplementationOnce(() => { throw failure; });
  try {
    expect(() => restore(JSON.parse(JSON.stringify(saved)), { source, budget: limited })).toThrow(failure);
    expect(reconcile).toHaveBeenCalledOnce();
    expect([...limited.retainedValues()]).toEqual([]);
    expect(() => limited.acquireCompileOwner(true).release()).not.toThrow();
  } finally { reconcile.mockRestore(); }
});

it("keeps the legacy intrinsic shape for single-realm snapshots and rejects malformed realm IDs", async () => {
  const result = await run("return Number");
  if (!result.ok) throw result.error;
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { value: result.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const entry = Object.entries(saved.heap!).find(([, node]) => node.kind === "intrinsic");
  if (entry === undefined) throw new Error("Missing intrinsic node");
  expect(Object.values(saved.heap!).filter(node => node.kind === "intrinsic").every(node => !Object.hasOwn(node, "realm"))).toBe(true);
  expect(() => restore(JSON.parse(JSON.stringify(saved)), { source })).not.toThrow();
  for (const realm of [0, -1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
    const forged = JSON.parse(JSON.stringify(saved));
    forged.heap[entry[0]].realm = realm;
    expect(() => restore(forged, { source })).toThrow("Invalid intrinsic realm identity");
  }
});

it("restores each originating sandbox symbol registry without merging its entries", async () => {
  const first = await run('return [Symbol,Symbol.for("key")]');
  const second = await run('return [Symbol,Symbol.for("key")]');
  if (!first.ok || !second.ok) throw new Error("Missing symbol realms");
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { first: first.returnValue, second: second.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const a = restored.currentScope.lookup("first").value, b = restored.currentScope.lookup("second").value;
  if (!Array.isArray(a) || !Array.isArray(b)) throw new Error("Missing restored symbol realms");
  expect(a[1] === b[1]).toBe(false);
  for (const graph of [a, b]) {
    if (!isSandboxClosure(graph[0])) throw new Error("Missing Symbol constructor");
    const method = graph[0].properties?.for;
    if (!isSandboxClosure(method)) throw new Error("Missing registry method");
    expect(await invokeBuiltinClosure(method, ["key"], restored.budget, undefined, undefined)).toBe(graph[1]);
  }
});

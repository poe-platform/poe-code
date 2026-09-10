import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { getSandboxPrototype } from "../interp/object-model.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  { expression: "()=>[]", expected: "Array.prototype", identity: false },
  { expression: "()=>({})", expected: "Object.prototype", identity: false },
  { expression: "()=>/x/", expected: "RegExp.prototype", identity: false },
  { expression: "()=>new Map()", expected: "Map.prototype", identity: false },
  { expression: 'Function("return this")', expected: "globalThis", identity: true }
])("restores the originating realm for $expression", async ({ expression, expected, identity }) => {
  const source = `return [${expression},${expected}]`;
  const first = await run(source), second = await run(source);
  if (!first.ok || !second.ok) throw new Error("Missing original realms");
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { first: first.returnValue, second: second.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  let restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  for (let round = 0; round < 2; round++) {
    for (const name of ["first", "second"]) {
      const graph = restored.currentScope.lookup(name).value;
      if (!Array.isArray(graph) || !isSandboxClosure(graph[0])) throw new Error("Missing restored reader");
      const value = await invokeBuiltinClosure(graph[0], [], restored.budget, undefined, undefined);
      if (value === null || typeof value !== "object") throw new Error("Missing guest object");
      expect((identity ? value : getSandboxPrototype(value, new Budget())) === graph[1]).toBe(true);
    }
    if (round === 0) restored = restore(JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "module", bindings: {
        first: restored.currentScope.lookup("first").value,
        second: restored.currentScope.lookup("second").value
      } }], callStack: [], pendingPromises: [], moduleBindings: {} }))), { source });
  }
});

it("keeps legacy single-realm functions and rejects malformed function realm IDs", async () => {
  const source = "return ()=>[]";
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { value: result.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const entry = Object.entries(saved.heap!).find(([, node]) => node.kind === "guest-function");
  if (entry === undefined) throw new Error("Missing guest function");
  expect(Object.hasOwn(entry[1], "realm")).toBe(false);
  expect(() => restore(JSON.parse(JSON.stringify(saved)), { source })).not.toThrow();
  for (const realm of [0, -1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
    const forged = JSON.parse(JSON.stringify(saved));
    forged.heap[entry[0]].realm = realm;
    expect(() => restore(forged, { source })).toThrow("Invalid function realm identity");
  }
});

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
  { expression: 'Function("return this")', expected: "globalThis", identity: true },
  { expression: "(()=>{const C=class { constructor(){return []} };return ()=>new C()})()", expected: "Array.prototype", identity: false },
  { expression: "(()=>{const C=class { constructor(){return {}} };return ()=>new C()})()", expected: "Object.prototype", identity: false },
  { expression: "(()=>{const C=class { constructor(){return /x/} };return ()=>new C()})()", expected: "RegExp.prototype", identity: false },
  { expression: "(()=>{class C { value=[] };return ()=>new C().value})()", expected: "Array.prototype", identity: false },
  { expression: "(()=>{class C { #value={};get(){return this.#value} };return ()=>new C().get()})()", expected: "Object.prototype", identity: false },
  { expression: "(()=>{class B{};class C extends B { value=/x/ };return ()=>new C().value})()", expected: "RegExp.prototype", identity: false },
  { expression: "(()=>{function* f(){yield 0;while(true)yield []};const g=f();g.next();return ()=>g.next().value})()", expected: "Array.prototype", identity: false },
  { expression: "(()=>{function* f(){yield 0;while(true)yield {}};const g=f();g.next();return ()=>g.next().value})()", expected: "Object.prototype", identity: false },
  { expression: "(()=>{function* f(){yield 0;while(true)yield /x/};const g=f();g.next();return ()=>g.next().value})()", expected: "RegExp.prototype", identity: false },
  { expression: "(()=>{function* f(){while(true)yield []};const g=f();return ()=>g.next().value})()", expected: "Array.prototype", identity: false }
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

it.each([
  { source: "return ()=>[]", kind: "guest-function", label: "function" },
  { source: "return class {}", kind: "guest-class", label: "class" },
  { source: "return (function*(){yield []})()", kind: "guest-generator", label: "generator" }
])("keeps legacy single-realm $label records and rejects malformed realm IDs", async ({ source, kind, label }) => {
  const result = await run(source);
  if (!result.ok) throw result.error;
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { value: result.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const entry = Object.entries(saved.heap!).find(([, node]) => node.kind === kind);
  if (entry === undefined) throw new Error("Missing guest function");
  expect(Object.hasOwn(entry[1], "realm")).toBe(false);
  expect(() => restore(JSON.parse(JSON.stringify(saved)), { source })).not.toThrow();
  for (const realm of [0, -1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
    const forged = JSON.parse(JSON.stringify(saved));
    forged.heap[entry[0]].realm = realm;
    expect(() => restore(forged, { source })).toThrow(`Invalid ${label} realm identity`);
  }
});

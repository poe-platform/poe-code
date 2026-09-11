import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "../interp/interpreter.js";
import { isSandboxClosure, isSandboxPromise, type SandboxClosure } from "../interp/values.js";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { serialize, type RuntimeSnapshotValue, type SerializedSnapshot } from "./serialize.js";
import { restore } from "./restore.js";

it("serializes shared closure environments as heap identities rather than host call implementations", async () => {
  const source = "{let count=3;return [()=>++count,()=>count]}";
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { pair: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const wire = JSON.parse(JSON.stringify(snapshot)) as SerializedSnapshot;
  const functions = Object.values(wire.heap!).filter(node => node.kind === "guest-function");
  expect(functions).toHaveLength(2);
  expect(functions[0].scope).toEqual(functions[1].scope);
  const scope = functions[0].scope as { kind: "ref"; id: number };
  expect(wire.heap![scope.id]).toMatchObject({ kind: "scope-frame",
    cells: expect.arrayContaining([{ kind: "let", initialized: true, value: 3 }]) });
});

it("restores independently callable closures with shared lexical cells without replaying source", async () => {
  const source = "{let count=3;return [()=>++count,()=>count]}";
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { pair: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("pair");
  expect(binding.found).toBe(true);
  if (!binding.found) throw new Error("Missing restored pair");
  const [increment, read] = binding.value as SandboxClosure[];
  expect(isSandboxClosure(increment)).toBe(true);
  expect(await increment.call([])).toBe(4);
  expect(await read.call([])).toBe(4);
  const [, originalRead] = original.returnValue as SandboxClosure[];
  expect(await originalRead.call([])).toBe(3);
});

it.each([
  ["{let n=4;return async (x=2)=>n+x}", 6],
  ["{return function factorial(n=5){return n<2?1:n*factorial(n-1)}}", 120],
  ["{let owner={n:7,read(){return this.n}};return ()=>owner.read()}", 7],
  ["{Number.isNaN.extra=9;return ()=>Number.isNaN.extra}", 9],
  ["{let n=2;let o={get value(){return ++n}};return ()=>o.value}", 3]
])("restores callable behavior for %s", async (source, expected) => {
  const ast = parseModule(source);
  const budget = new Budget();
  const { Number: number } = createBuiltinBindings({ budget });
  const original = await interpret(ast.body[0], { budget, bindings: { Number: number } });
  if (!original.ok) throw new Error(original.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { fn: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("fn");
  if (!binding.found) throw new Error("Missing restored function");
  const result = await (binding.value as SandboxClosure).call([]);
  expect(isSandboxPromise(result) ? await result.promise : result).toBe(expected);
});

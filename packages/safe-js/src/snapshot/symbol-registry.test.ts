import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ["const symbol=Symbol.for('key');return ()=>[symbol===Symbol.for('key'),Symbol.keyFor(symbol)]", [true, "key"]],
  ["const keyFor=Symbol.keyFor;const symbol=Symbol.for('key');Symbol.keyFor=()=>'changed';return ()=>keyFor(symbol)", "key"],
  ["const make=Symbol.for;Symbol.for=()=>Symbol('other');const symbol=make('key');return ()=>make('key')===symbol", true],
  ["const key=Symbol.for('key');const object={[key]:7};const map=new Map([[key,object]]);return ()=>map.get(Symbol.for('key'))[Symbol.for('key')]", 7],
  ["class Box{#key=Symbol.for('key');read(){return this.#key===Symbol.for('key')}}const box=new Box();return ()=>box.read()", true],
  ["const key=Symbol.for('');const local=Symbol('');return ()=>[Symbol.keyFor(key),Symbol.keyFor(local),key!==local]", ["", undefined, true]]
] as const)("restores symbol registry identity: %s", async (source, expected) => {
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const budget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget}).currentScope.lookup("read");
  assert(binding.found && isSandboxClosure(binding.value));
  expect(await invokeBuiltinClosure(binding.value, [], budget, undefined, undefined)).toEqual(expected);
});

it.each(["duplicate-key", "wrong-owner", "wrong-kind", "wrong-description", "conflicting-registry"])("rejects malformed symbol registry snapshots: %s", async mutation => {
  const source = "const symbol=Symbol.for('key');return ()=>[symbol===Symbol.for('key'),Symbol.keyFor(symbol)]";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const node = Object.values(snapshot.heap ?? {}).find(node => node.kind === "intrinsic" && node.symbolRegistry?.length === 1);
  assert(node?.kind === "intrinsic" && node.symbolRegistry !== undefined);
  if (mutation === "duplicate-key") node.symbolRegistry.push(node.symbolRegistry[0]);
  if (mutation === "wrong-owner") node.id = JSON.stringify(["Object"]);
  if (mutation === "wrong-kind") node.symbolRegistry[0][1] = 7;
  if (mutation === "wrong-description") node.symbolRegistry[0][0] = "other";
  if (mutation === "conflicting-registry") node.symbolRegistry = [];
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()})).toThrow();
});

it("restores independent registries without sharing symbols between runs", async () => {
  const source = "const symbol=Symbol.for('key');return ()=>[symbol,Symbol.for('key'),Symbol.keyFor(symbol)]";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const symbols: unknown[] = [];
  for (let index = 0; index < 2; index++) {
    const budget = new Budget();
    const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget}).currentScope.lookup("read");
    assert(binding.found && isSandboxClosure(binding.value));
    const value = await invokeBuiltinClosure(binding.value, [], budget, undefined, undefined);
    assert(Array.isArray(value));
    expect(value[0]).toBe(value[1]);
    expect(value[2]).toBe("key");
    symbols.push(value[0]);
  }
  expect(symbols[0]).not.toBe(symbols[1]);
});

it("restores bare registry method aliases without a captured constructor", async () => {
  const source = "return [Symbol.for('key'),Symbol.for,Symbol.keyFor]";
  const result = await run(source);
  assert(result.ok && Array.isArray(result.returnValue));
  const [key, make, keyFor] = result.returnValue;
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {key, make, keyFor} as Record<string, RuntimeSnapshotValue>}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const budget = new Budget();
  const scope = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget}).currentScope;
  const restoredKey = scope.lookup("key");
  const restoredMake = scope.lookup("make");
  const restoredKeyFor = scope.lookup("keyFor");
  assert(restoredKey.found && restoredMake.found && restoredKeyFor.found);
  assert(isSandboxClosure(restoredMake.value) && isSandboxClosure(restoredKeyFor.value));
  expect(await invokeBuiltinClosure(restoredMake.value, ["key"], budget, undefined, undefined)).toBe(restoredKey.value);
  expect(await invokeBuiltinClosure(restoredKeyFor.value, [restoredKey.value], budget, undefined, undefined)).toBe("key");
});

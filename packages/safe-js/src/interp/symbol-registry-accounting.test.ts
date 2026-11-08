import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each(["Symbol.for", "Symbol.keyFor"])("accounts for registry data retained by escaped %s", async name => {
  const result = await run(`Symbol.for("x".repeat(200));return ${name}`);
  assert(result.ok);
  expect(measureSandboxData([result.returnValue])).toBeGreaterThanOrEqual(401);
});

it("accounts for restored aliases and newly registered keys without double charging", async () => {
  const source = 'Symbol.for("x".repeat(200));return [Symbol.for,Symbol.keyFor]';
  const result = await run(source);
  assert(result.ok && Array.isArray(result.returnValue));
  const [make, keyFor] = result.returnValue;
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {make, keyFor} as Record<string, RuntimeSnapshotValue>}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const budget = new Budget();
  const scope = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget}).currentScope;
  const restoredMake = scope.lookup("make");
  const restoredKeyFor = scope.lookup("keyFor");
  assert(restoredMake.found && restoredKeyFor.found);
  assert(isSandboxClosure(restoredMake.value));
  const aliases = [restoredMake.value, restoredKeyFor.value];
  const before = measureSandboxData(aliases);
  expect(before).toBe(measureSandboxData([make, keyFor]));
  expect(before).toBeGreaterThanOrEqual(401);
  await invokeBuiltinClosure(restoredMake.value, ["y".repeat(300)], budget, undefined, undefined);
  const after = measureSandboxData(aliases);
  expect(after - before).toBe(602);
  await invokeBuiltinClosure(restoredMake.value, ["y".repeat(300)], budget, undefined, undefined);
  expect(measureSandboxData(aliases)).toBe(after);
});

it("counts the registry once when both aliases retain it", async () => {
  const result = await run('Symbol.for("x".repeat(200));return [Symbol.for,Symbol.keyFor]');
  assert(result.ok && Array.isArray(result.returnValue));
  const [make, keyFor] = result.returnValue;
  const one = measureSandboxData([make]);
  expect(one).toBeGreaterThanOrEqual(401);
  expect(measureSandboxData([make, keyFor])).toBe(one + 1);
  expect(measureSandboxData([make], {ignoreClosures: true})).toBe(1);
  expect(measureSandboxData([make], {ignoreClosureCaptures: true})).toBe(1);
});

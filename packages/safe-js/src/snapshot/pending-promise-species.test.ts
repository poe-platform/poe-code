import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure, isSandboxPromise } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { promiseContinuations, promiseProducers } from "../interp/promise-continuations.js";

it.each([
  ["const result = P.all([c.promise])", [7]],
  ["const result = Promise.all([c.promise])", [7]],
  ["const result = Promise.race([c.promise])", 7]
] as const)("restores unresolved aggregate capability callbacks: %s", async (expression, expected) => {
  const source = `const c=Promise.withResolvers();class P extends Promise{};${expression};Object.setPrototypeOf(result,Promise.prototype);return [result,c.resolve]`;
  const control = await run(source);
  assert(control.ok && Array.isArray(control.returnValue));
  const [promise, resolve] = control.returnValue;
  assert(isSandboxPromise(promise) && isSandboxClosure(resolve));
  const budget = new Budget();
  await invokeBuiltinClosure(resolve, [7], budget, undefined, undefined);
  expect(await awaitSandboxValue(promise, undefined, budget)).toEqual(expected);

  const fresh = await run(source);
  assert(fresh.ok && Array.isArray(fresh.returnValue));
  const snapshotPromise = fresh.returnValue[0] as RuntimeSnapshotValue;
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {promise: snapshotPromise, resolve: fresh.returnValue[1] as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const restoredBudget = new Budget();
  const scope = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: restoredBudget}).currentScope;
  const restoredPromise = scope.lookup("promise");
  const restoredResolve = scope.lookup("resolve");
  assert(restoredPromise.found && isSandboxPromise(restoredPromise.value));
  assert(restoredResolve.found && isSandboxClosure(restoredResolve.value));
  await invokeBuiltinClosure(restoredResolve.value, [7], restoredBudget, undefined, undefined);
  expect(await awaitSandboxValue(restoredPromise.value, undefined, restoredBudget)).toEqual(expected);
});

it("retains subclass producer links when only its result is a snapshot root", async () => {
  const source = "const c=Promise.withResolvers();class P extends Promise{};c.promise.constructor={[Symbol.species]:P};const result=c.promise.then(value=>value+1);Object.setPrototypeOf(result,Promise.prototype);return [result]";
  const fresh = await run(source);
  assert(fresh.ok && Array.isArray(fresh.returnValue));
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {promise: fresh.returnValue[0] as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()}).currentScope.lookup("promise");
  assert(binding.found && isSandboxPromise(binding.value));
  const producers = promiseProducers.get(binding.value);
  assert(producers !== undefined && producers.size === 1);
  const continuation = promiseContinuations.get([...producers][0]!);
  assert(continuation?.kind === "reaction");
  expect(continuation.capability?.promise).toBe(binding.value);
  expect(continuation.source).not.toBe(binding.value);
  expect(isSandboxPromise(continuation.source)).toBe(true);
});

import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { getPromiseProperties, isSandboxClosure, isSandboxPromise } from "../interp/values.js";
import { promiseContinuations, promiseProducers } from "../interp/promise-continuations.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ["all", "Promise.resolve(3)", "c.resolve(7)", "await result", [3, 7]],
  ["all", "c.promise", "c.resolve(7)", "await result", [7, 7]],
  ["allSettled", "Promise.reject('first')", "c.resolve(7)", "await result", [
    {status: "rejected", reason: "first"}, {status: "fulfilled", value: 7}
  ]],
  ["any", "Promise.reject('first')", "c.reject('second')", "await result.catch(error=>error.errors)", ["first", "second"]],
  ["race", "new Promise(()=>{})", "c.resolve(7)", "await result", 7],
  ["race", "Promise.resolve(3)", "c.resolve(7)", "await result", 3]
] as const)("restores partially completed Promise.%s without repeating resolve effects", async (method, first, settle, read, expected) => {
  const source = `let resolves=0;class P extends Promise{static resolve(value){resolves++;return super.resolve(value)}}const c=Promise.withResolvers();const result=P.${method}([${first},c.promise]);await 0;await 0;return async()=>{${settle};return [${read},resolves,result instanceof P]}`;
  const control = await run(source);
  assert(control.ok && isSandboxClosure(control.returnValue));
  const controlBudget = new Budget();
  const controlValue = await invokeBuiltinClosure(control.returnValue, [], controlBudget, undefined, undefined);
  expect(await awaitSandboxValue(controlValue, undefined, controlBudget)).toEqual([expected, 2, true]);

  const fresh = await run(source);
  assert(fresh.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: fresh.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const budget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget}).currentScope.lookup("read");
  assert(binding.found && isSandboxClosure(binding.value));
  const value = await invokeBuiltinClosure(binding.value, [], budget, undefined, undefined);
  expect(await awaitSandboxValue(value, undefined, budget)).toEqual([expected, 2, true]);
});

it("retains the pending input when only the aggregate result is a snapshot root", async () => {
  const source = "const c=Promise.withResolvers();c.promise.finish=c.resolve;return [Promise.all([c.promise])]";
  const fresh = await run(source);
  assert(fresh.ok && Array.isArray(fresh.returnValue) && isSandboxPromise(fresh.returnValue[0]));
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {result: fresh.returnValue[0]}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const budget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget}).currentScope.lookup("result");
  assert(binding.found && isSandboxPromise(binding.value));
  const producers = promiseProducers.get(binding.value);
  assert(producers !== undefined && producers.size === 1);
  const producer = [...producers][0]!;
  const continuation = promiseContinuations.get(producer);
  assert(continuation?.kind === "reaction");
  const finish = getPromiseProperties(continuation.source).finish;
  assert(isSandboxClosure(finish));
  await invokeBuiltinClosure(finish, [7], budget, undefined, undefined);
  expect(await awaitSandboxValue(binding.value, undefined, budget)).toEqual([7]);
  await producer.promise;
  expect(promiseProducers.has(binding.value)).toBe(false);
});

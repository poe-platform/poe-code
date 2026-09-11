import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { awaitSandboxValue } from "./cancel.js";
import { thenableContinuations, thenableResolvers } from "./promise-continuations.js";
import { createThenableBridge } from "./promise.js";
import { isSandboxClosure, isSandboxPromise, measureSandboxData } from "./values.js";

it("exposes native resolver function metadata and binding", async () => {
  const source = "let finish;Promise.resolve({then(resolve){finish=resolve}});await 0;return [finish.name,finish.length,typeof finish.bind]";
  const expected = await new Function(`return (async()=>{${source}})()`)();
  const result = await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it.each([
  "const log=[];Promise.resolve({get then(){log.push('get');return ()=>log.push('then')}});log.push('after');await 0;return log",
  "const log=[];const c=Promise.withResolvers();c.resolve({get then(){log.push('get');return ()=>log.push('then')}});log.push('after');await 0;return log",
  "const log=[];new Promise(resolve=>{resolve({get then(){log.push('get');return ()=>log.push('then')}});log.push('executor')});log.push('after');await 0;return log",
  "const log=[];const p=Promise.resolve({get then(){log.push('get');throw 7}});log.push('after');try{await p}catch(e){log.push(e)}return log"
])("preserves native synchronous then-getter ordering: %s", async source => {
  const expected = await new Function(`return (async()=>{${source}})()`)();
  const result = await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it("shares first-settlement state after a thenable invocation returns", async () => {
  const result = await run("let finish;let fail;const p=Promise.resolve({then(resolve,reject){finish=resolve;fail=reject}});await 0;return [finish,fail,p]");
  assert(result.ok && Array.isArray(result.returnValue));
  const [finish, fail, promise] = result.returnValue;
  assert(isSandboxClosure(finish) && isSandboxClosure(fail) && isSandboxPromise(promise));
  const state = thenableResolvers.get(finish)?.continuation;
  assert(state !== undefined);
  expect(thenableResolvers.get(fail)?.continuation).toBe(state);
  expect(thenableContinuations.get(promise)).toBe(state);
  expect(state.invocationPending).toBe(false);
  expect(state.completed).toBe(false);
  expect(state.settlement).toBeUndefined();
  const budget = new Budget();
  await invokeBuiltinClosure(finish, [7], budget, undefined, undefined);
  await invokeBuiltinClosure(fail, [9], budget, undefined, undefined);
  expect(await awaitSandboxValue(promise, undefined, budget)).toBe(7);
  expect(state.settlement).toEqual({state: "fulfilled", value: 7});
  expect(state.completed).toBe(true);
  expect(thenableContinuations.has(promise)).toBe(false);
});

it("accounts for the source retained only by an escaped thenable resolver", async () => {
  const result = await run("let finish;Promise.resolve({then(resolve){finish=resolve}});await 0;return finish");
  assert(result.ok && isSandboxClosure(result.returnValue));
  const state = thenableResolvers.get(result.returnValue)?.continuation;
  assert(state !== undefined && state.source !== null && typeof state.source === "object");
  Object.defineProperty(state.source, "payload", {value: "", writable: true, enumerable: true});
  const before = measureSandboxData([result.returnValue]);
  Object.defineProperty(state.source, "payload", {value: "x".repeat(400)});
  expect(measureSandboxData([result.returnValue]) - before).toBe(400);
});

it("recreates an already-returned invocation without calling its then method", async () => {
  const result = await run("let finish;const p=Promise.resolve({then(resolve){finish=resolve}});await 0;return finish");
  assert(result.ok && isSandboxClosure(result.returnValue));
  const original = thenableResolvers.get(result.returnValue)?.continuation;
  assert(original !== undefined);
  const restored = {...original, owner: undefined};
  const bridge = createThenableBridge(restored, {budget: new Budget()});
  await invokeBuiltinClosure(bridge.resolvers[0], [7], new Budget(), undefined, undefined);
  await invokeBuiltinClosure(bridge.resolvers[1], [9], new Budget(), undefined, undefined);
  expect(await bridge.promise).toBe(7);
  expect(original.settlement).toBeUndefined();
  expect(restored.settlement).toEqual({state: "fulfilled", value: 7});
});

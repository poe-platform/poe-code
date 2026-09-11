import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { awaitSandboxValue } from "./cancel.js";
import { createSandboxClosure, getPromiseProperties, isSandboxClosure, isSandboxPromise, measureSandboxData } from "./values.js";
import { attachPendingPromiseReaction, createPendingPromiseCapability } from "./promise.js";
import { promiseContinuations, promiseReactionResults, promiseProducers, trackPromiseContinuation, promiseAdoptions, promiseAdoptionBridges, promiseAdoptionResolvers } from "./promise-continuations.js";

it("records pending capabilities and their reaction links, then releases settled metadata", async () => {
  const result = await run("const c=Promise.withResolvers();const handler=value=>value+1;return [c.promise,c.resolve,c.promise.then(handler),handler]");
  assert(result.ok && Array.isArray(result.returnValue));
  const [promise, resolve, chained, handler] = result.returnValue;
  assert(isSandboxPromise(promise) && isSandboxPromise(chained) && isSandboxClosure(resolve));
  expect(promiseContinuations.get(promise)).toMatchObject({kind: "capability", state: {promise, settled: false}});
  expect(promiseContinuations.get(chained)).toMatchObject({kind: "reaction", source: promise, onFulfilled: handler});
  expect(promiseReactionResults.get(promise)?.has(chained)).toBe(true);
  const budget = new Budget();
  await invokeBuiltinClosure(resolve, [7], budget, undefined, undefined);
  expect(await awaitSandboxValue(chained, undefined, budget)).toBe(8);
  expect(promiseContinuations.has(promise)).toBe(false);
  expect(promiseContinuations.has(chained)).toBe(false);
  expect(promiseReactionResults.get(promise)?.size ?? 0).toBe(0);
});

it("retains a subclass producer until its reaction runs even if its result settles early", async () => {
  const result = await run("let settleResult;let calls=0;class P extends Promise{constructor(executor){super((resolve,reject)=>{settleResult=resolve;executor(resolve,reject)})}}const c=Promise.withResolvers();c.promise.constructor={[Symbol.species]:P};const chained=c.promise.then(()=>{calls++;return 7});return [c.promise,chained,c.resolve,settleResult,()=>calls]");
  assert(result.ok && Array.isArray(result.returnValue));
  const [source, promise, resolveSource, resolveResult, readCalls] = result.returnValue;
  assert(isSandboxPromise(source) && isSandboxPromise(promise) && isSandboxClosure(resolveSource) && isSandboxClosure(resolveResult) && isSandboxClosure(readCalls));
  const producers = promiseProducers.get(promise);
  assert(producers !== undefined && producers.size === 1);
  const producer = [...producers][0]!;
  expect(promiseReactionResults.get(source)?.has(producer)).toBe(true);
  expect(promiseContinuations.get(producer)).toMatchObject({kind: "reaction", source, capability: {promise, resolve: resolveResult}});
  const budget = new Budget();
  await invokeBuiltinClosure(resolveResult, [99], budget, undefined, undefined);
  expect(await promise.promise).toBe(99);
  expect(promiseProducers.get(promise)?.has(producer)).toBe(true);
  await invokeBuiltinClosure(resolveSource, [7], budget, undefined, undefined);
  await producer.promise;
  expect(await invokeBuiltinClosure(readCalls, [], budget, undefined, undefined)).toBe(1);
  expect(promiseProducers.has(promise)).toBe(false);
  expect(promiseReactionResults.has(source)).toBe(false);
});

it.each(["source", "result"])("accounts for a pending reaction handler from its %s", async root => {
  const budget = new Budget();
  const source = createPendingPromiseCapability(budget);
  const result = createPendingPromiseCapability(budget);
  const payload = {text: ""};
  const handler = createSandboxClosure({sandbox: true, retainedValues: () => [payload], call: () => 7});
  attachPendingPromiseReaction(source.promise, result, handler, undefined, budget);
  const promise = root === "source" ? source.promise : result.promise;
  const before = measureSandboxData([promise]);
  payload.text = "x".repeat(400);
  expect(measureSandboxData([promise]) - before).toBe(400);
  await invokeBuiltinClosure(source.resolve, [7], budget, undefined, undefined);
  expect(await awaitSandboxValue(result.promise, undefined, budget)).toBe(7);
  expect(measureSandboxData([promise])).toBeLessThan(before + 400);
});

it("accounts for producer captures through the actual result and deduplicates shared producer links", () => {
  const budget = new Budget();
  const source = createPendingPromiseCapability(budget);
  const result = createPendingPromiseCapability(budget);
  const completion = createPendingPromiseCapability(budget);
  const payload = {text: ""};
  const handler = createSandboxClosure({sandbox: true, retainedValues: () => [payload], call: () => 7});
  trackPromiseContinuation(completion.promise, {kind: "reaction", phase: "waiting", source: source.promise,
    onFulfilled: handler, onRejected: undefined, capability: result});
  const roots = [result.promise, source.promise, completion.promise];
  const before = measureSandboxData([result.promise]);
  const beforeShared = measureSandboxData(roots);
  const beforeIgnored = measureSandboxData([result.promise], {ignoreClosureCaptures: true});
  payload.text = "x".repeat(400);
  expect(measureSandboxData([result.promise]) - before).toBe(400);
  expect(measureSandboxData(roots) - beforeShared).toBe(400);
  expect(measureSandboxData([result.promise], {ignoreClosureCaptures: true})).toBe(beforeIgnored);
});

it("accounts for the source retained by a locked adoption", async () => {
  const budget = new Budget();
  const owner = createPendingPromiseCapability(budget);
  const source = createPendingPromiseCapability(budget);
  const properties = getPromiseProperties(source.promise);
  Object.defineProperty(properties, "payload", {value: "", writable: true, configurable: true});
  await invokeBuiltinClosure(owner.resolve, [source.promise], budget, undefined, undefined);
  const before = measureSandboxData([owner.promise]);
  Object.defineProperty(properties, "payload", {value: "x".repeat(400)});
  expect(measureSandboxData([owner.promise]) - before).toBe(400);
  await invokeBuiltinClosure(source.resolve, [7], budget, undefined, undefined);
  expect(await awaitSandboxValue(owner.promise, undefined, budget)).toBe(7);
});

it("records the locked resolution input while adoption is pending", async () => {
  const result = await run("const first=Promise.withResolvers();const second=Promise.withResolvers();first.resolve(second.promise);first.resolve(99);return [first.promise,second.promise,second.resolve]");
  assert(result.ok && Array.isArray(result.returnValue));
  const [first, second, resolve] = result.returnValue;
  assert(isSandboxPromise(first) && isSandboxPromise(second) && isSandboxClosure(resolve));
  expect(promiseContinuations.get(first)).toMatchObject({kind: "capability", state: {settled: true}, resolution: {status: "fulfilled", value: second}});
  const token = promiseAdoptions.get(first);
  assert(token !== undefined);
  const bridge = promiseAdoptionBridges.get(token);
  assert(bridge !== undefined);
  expect(bridge.source).toBe(second);
  expect(bridge.owner).toBe(first);
  expect(bridge.settled).toBe(false);
  expect(promiseAdoptionResolvers.get(bridge.resolve)).toEqual({bridge: token, action: "fulfilled"});
  expect(promiseAdoptionResolvers.get(bridge.reject)).toEqual({bridge: token, action: "rejected"});
  expect(Object.keys(token)).toEqual([]);
  const budget = new Budget();
  await invokeBuiltinClosure(resolve, [7], budget, undefined, undefined);
  expect(await awaitSandboxValue(first, undefined, budget)).toBe(7);
  expect(promiseAdoptions.has(first)).toBe(false);
  expect(promiseAdoptionBridges.has(token)).toBe(false);
  expect(promiseAdoptionResolvers.has(bridge.resolve)).toBe(false);
  expect(promiseAdoptionResolvers.has(bridge.reject)).toBe(false);
});

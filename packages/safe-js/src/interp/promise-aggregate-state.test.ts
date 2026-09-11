import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { isSandboxClosure, isSandboxPromise, measureSandboxData } from "./values.js";
import { promiseAggregateHandlers, promiseContinuations, promiseProducers } from "./promise-continuations.js";

it("preserves shared aggregate state and each entry's once-only settlement", async () => {
  const result = await run("const callbacks=[];class P extends Promise{static resolve(value){return {then(ok,fail){callbacks.push([ok,fail])}}}}const result=P.allSettled([1,2]);return [result,callbacks]");
  assert(result.ok && Array.isArray(result.returnValue));
  const [promise, callbacks] = result.returnValue;
  assert(isSandboxPromise(promise) && Array.isArray(callbacks));
  const [first, second] = callbacks;
  assert(Array.isArray(first) && Array.isArray(second));
  const [resolve, reject] = first;
  const [resolveSecond] = second;
  assert(isSandboxClosure(resolve) && isSandboxClosure(reject) && isSandboxClosure(resolveSecond));
  const fulfilled = promiseAggregateHandlers.get(resolve);
  const rejected = promiseAggregateHandlers.get(reject);
  const other = promiseAggregateHandlers.get(resolveSecond);
  assert(fulfilled !== undefined && rejected !== undefined && other !== undefined);
  expect(fulfilled.entry).toBe(rejected.entry);
  expect(fulfilled.entry.aggregate).toBe(other.entry.aggregate);
  expect(fulfilled.entry.index).toBe(0);
  expect(other.entry.index).toBe(1);
  expect(fulfilled.entry.aggregate.remaining).toBe(2);
  const budget = new Budget();
  await invokeBuiltinClosure(resolve, [7], budget, undefined, undefined);
  await invokeBuiltinClosure(reject, ["ignored"], budget, undefined, undefined);
  expect(fulfilled.entry.called).toBe(true);
  expect(fulfilled.entry.aggregate.remaining).toBe(1);
  expect(fulfilled.entry.aggregate.values).toEqual([{status: "fulfilled", value: 7}, undefined]);
  await invokeBuiltinClosure(resolveSecond, [9], budget, undefined, undefined);
  expect(await promise.promise).toEqual([{status: "fulfilled", value: 7}, {status: "fulfilled", value: 9}]);
  expect(fulfilled.entry.aggregate.remaining).toBe(0);
});

it("accounts for partial aggregate values reachable only through its result", async () => {
  const result = await run("const payload={text:''};const c=Promise.withResolvers();const result=Promise.all([Promise.resolve(payload),c.promise]);await 0;await 0;return [result,()=>{payload.text='x'.repeat(400)},c.resolve]");
  assert(result.ok && Array.isArray(result.returnValue));
  const [promise, grow, finish] = result.returnValue;
  assert(isSandboxPromise(promise) && isSandboxClosure(grow) && isSandboxClosure(finish));
  const before = measureSandboxData([promise]);
  const budget = new Budget();
  await invokeBuiltinClosure(grow, [], budget, undefined, undefined);
  expect(measureSandboxData([promise]) - before).toBe(400);
  await invokeBuiltinClosure(finish, [7], budget, undefined, undefined);
  expect(await promise.promise).toEqual([{text: "x".repeat(400)}, 7]);
});

it("does not steal another aggregate's producer when species reuses a promise", async () => {
  const result = await run("const shared=Promise.withResolvers();function C(executor){executor(shared.resolve,shared.reject);return shared.promise}class P extends Promise{static resolve(value){return value}}const a=Promise.withResolvers();const b=Promise.withResolvers();a.promise.constructor={[Symbol.species]:C};b.promise.constructor={[Symbol.species]:C};const first=P.all([a.promise]);const second=P.all([b.promise]);return [first,second,a.promise,b.promise]");
  assert(result.ok && Array.isArray(result.returnValue));
  const [first, second, a, b] = result.returnValue;
  assert(isSandboxPromise(first) && isSandboxPromise(second) && isSandboxPromise(a) && isSandboxPromise(b));
  const firstProducers = promiseProducers.get(first);
  const secondProducers = promiseProducers.get(second);
  assert(firstProducers !== undefined && secondProducers !== undefined);
  expect(firstProducers.size).toBe(1);
  expect(secondProducers.size).toBe(1);
  expect(promiseContinuations.get([...firstProducers][0]!)).toMatchObject({kind: "reaction", source: a, aggregate: first});
  expect(promiseContinuations.get([...secondProducers][0]!)).toMatchObject({kind: "reaction", source: b, aggregate: second});
});

it("does not claim unrelated reactions registered by a species getter", async () => {
  const result = await run("class P extends Promise{static resolve(value){return value}}const c=Promise.withResolvers();c.promise.constructor={get [Symbol.species](){c.promise.constructor=Promise;c.promise.then(()=>1);return Promise}};return [P.all([c.promise])]");
  assert(result.ok && Array.isArray(result.returnValue) && isSandboxPromise(result.returnValue[0]));
  expect(promiseProducers.get(result.returnValue[0])?.size).toBe(1);
});

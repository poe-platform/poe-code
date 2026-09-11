import { assert, expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { attachPendingPromiseReaction, createPendingPromiseCapability } from "../interp/promise.js";
import { linkPromiseAggregateProducer, promiseContinuations } from "../interp/promise-continuations.js";
import { unrepresentedPromiseContinuations } from "../interp/promise-tracker.js";
import { inMemoryRunSnapshots, serializeSafeJSSnapshot } from "./dump-format.js";

it("keeps unresolved replay metadata exclusive to trusted in-memory snapshots", () => {
  const {promise} = createPendingPromiseCapability(new Budget());
  unrepresentedPromiseContinuations.add(promise);
  const snapshot = {sourceHash: "source", promise};
  expect(() => serializeSafeJSSnapshot(snapshot)).toThrow("unrepresented promise continuation");
  inMemoryRunSnapshots.add(snapshot);
  expect(() => serializeSafeJSSnapshot(snapshot)).not.toThrow();
  expect(() => serializeSafeJSSnapshot({...snapshot, trustedRunReplay: true}))
    .toThrow("unrepresented promise continuation");
});

it("retains the guest promise target of a settled resolver in trusted replay", async () => {
  const {promise, resolve} = createPendingPromiseCapability(new Budget());
  unrepresentedPromiseContinuations.add(promise);
  resolve.call([7]);
  expect(await promise.promise).toBe(7);
  const snapshot = {sourceHash: "source", promise, resolve};
  inMemoryRunSnapshots.add(snapshot);
  const dumped = JSON.parse(serializeSafeJSSnapshot(snapshot)) as {
    heap: Record<string, {kind: string; promise?: {id: number}}>
  };
  const resolver = Object.values(dumped.heap).find(node => node.kind === "promise-resolver");
  assert(resolver?.promise !== undefined);
  expect(dumped.heap[String(resolver.promise.id)].kind).toBe("guest-promise");
});

it("keeps pending resolvers on the same trusted metadata path as their target", () => {
  const {promise, resolve} = createPendingPromiseCapability(new Budget());
  unrepresentedPromiseContinuations.add(promise);
  const snapshot = {sourceHash: "source", promise, resolve};
  inMemoryRunSnapshots.add(snapshot);
  const dumped = JSON.parse(serializeSafeJSSnapshot(snapshot)) as {heap?: Record<string, {kind: string}>};
  expect(Object.values(dumped.heap ?? {}).some(node => node.kind === "promise-resolver")).toBe(false);
});

it("keeps a replay-dependent producer graph exclusive to trusted snapshots", () => {
  const budget = new Budget();
  const source = createPendingPromiseCapability(budget);
  const result = createPendingPromiseCapability(budget);
  const reaction = createPendingPromiseCapability(budget);
  unrepresentedPromiseContinuations.add(source.promise);
  attachPendingPromiseReaction(source.promise, reaction, result.resolve, result.reject, budget);
  linkPromiseAggregateProducer(reaction.promise, result.promise);
  const snapshot = {sourceHash: "source", promise: result.promise, resolve: result.resolve};
  expect(() => serializeSafeJSSnapshot(snapshot)).toThrow("unrepresented promise continuation");
  inMemoryRunSnapshots.add(snapshot);
  const dumped = JSON.parse(serializeSafeJSSnapshot(snapshot)) as {heap?: Record<string, {kind: string}>};
  expect(Object.values(dumped.heap ?? {}).some(node =>
    ["pending-promise", "promise-reaction", "promise-resolver"].includes(node.kind))).toBe(false);
  expect(() => serializeSafeJSSnapshot({...snapshot})).toThrow("unrepresented promise continuation");
});

it("keeps running reaction components on the trusted replay path", () => {
  const budget = new Budget();
  const source = createPendingPromiseCapability(budget);
  const result = createPendingPromiseCapability(budget);
  const reaction = createPendingPromiseCapability(budget);
  attachPendingPromiseReaction(source.promise, reaction, result.resolve, result.reject, budget);
  linkPromiseAggregateProducer(reaction.promise, result.promise);
  const continuation = promiseContinuations.get(reaction.promise);
  assert(continuation?.kind === "reaction");
  continuation.phase = "running";
  const snapshot = {sourceHash: "source", promise: result.promise, resolve: result.resolve};
  expect(() => serializeSafeJSSnapshot(snapshot)).toThrow("active promise reaction");
  inMemoryRunSnapshots.add(snapshot);
  const dumped = JSON.parse(serializeSafeJSSnapshot(snapshot)) as {heap?: Record<string, {kind: string}>};
  expect(Object.values(dumped.heap ?? {}).some(node =>
    ["pending-promise", "promise-reaction", "promise-resolver"].includes(node.kind))).toBe(false);
  expect(() => serializeSafeJSSnapshot({...snapshot})).toThrow("active promise reaction");
});

import { expect, it } from "vitest";
import { Budget, SandboxError } from "./budget.js";
import { createGeneratorChannel } from "./generator.js";
import { attachPendingPromiseReaction, createPendingPromiseCapability } from "./promise.js";
import { createSandboxClosure, createSandboxGenerator, measureSandboxData } from "./values.js";
import { asyncGeneratorDrivers, asyncGeneratorRequestOwners, createAsyncGeneratorHandler, enqueueAsyncGeneratorRequest, type AsyncGeneratorDriver } from "./async-generator-driver.js";
import { serialize } from "../snapshot/serialize.js";
import { SnapshotNotReadyError } from "../snapshot/not-ready.js";
import { captureGuestHeapNode } from "../snapshot/guest-heap.js";

it("keeps queued requests pending while the active generator request awaits", async () => {
  const budget = new Budget();
  const awaited = createPendingPromiseCapability(budget);
  const events: string[] = [];
  const generator = createSandboxGenerator(createGeneratorChannel(async yieldValue => {
    events.push("start");
    const driver = asyncGeneratorDrivers.get(generator)!;
    driver.suspension = "await";
    const value = await yieldValue(awaited.promise, 1);
    events.push("resumed");
    driver.suspension = "yield";
    const sent = await yieldValue(value.value, 2);
    events.push("returned");
    return sent.value;
  }), {async: true});
  const first = enqueueAsyncGeneratorRequest(generator, "next", undefined, budget);
  const second = enqueueAsyncGeneratorRequest(generator, "next", 9, budget);
  const third = enqueueAsyncGeneratorRequest(generator, "next", 11, budget);
  expect(events).toEqual(["start"]);
  for (const request of [first, second, third]) expect(asyncGeneratorRequestOwners.get(request)).toBe(asyncGeneratorDrivers.get(generator));
  await awaited.resolve.call([7]);
  await expect(first.promise).resolves.toEqual({value: 7, done: false});
  await expect(second.promise).resolves.toEqual({value: 9, done: true});
  await expect(third.promise).resolves.toEqual({value: undefined, done: true});
  expect(events).toEqual(["start", "resumed", "returned"]);
  expect(asyncGeneratorDrivers.get(generator)?.requests).toEqual([]);
  for (const request of [first, second, third]) expect(asyncGeneratorRequestOwners.has(request)).toBe(false);
});

it("awaits a return value on a completed generator before advancing queued next", async () => {
  const budget = new Budget();
  const awaited = createPendingPromiseCapability(budget);
  const generator = createSandboxGenerator(createGeneratorChannel(async () => 1), {async: true});
  await enqueueAsyncGeneratorRequest(generator, "next", undefined, budget).promise;
  const returned = enqueueAsyncGeneratorRequest(generator, "return", awaited.promise, budget);
  const next = enqueueAsyncGeneratorRequest(generator, "next", undefined, budget);
  await awaited.resolve.call([7]);
  await expect(returned.promise).resolves.toEqual({value: 7, done: true});
  await expect(next.promise).resolves.toEqual({value: undefined, done: true});
});

it("rejects one failed request and continues draining the completed generator", async () => {
  const budget = new Budget();
  const generator = createSandboxGenerator(createGeneratorChannel(async () => {throw "failure";}), {async: true});
  const first = enqueueAsyncGeneratorRequest(generator, "next", undefined, budget);
  const second = enqueueAsyncGeneratorRequest(generator, "next", undefined, budget);
  await expect(first.promise).rejects.toBe("failure");
  await expect(second.promise).resolves.toEqual({value: undefined, done: true});
});

it("rejects the active request when result allocation exceeds the budget", async () => {
  const budget = new Budget({stringLength: 2});
  const generator = createSandboxGenerator(createGeneratorChannel(async () => "too long"), {async: true});
  const pending = enqueueAsyncGeneratorRequest(generator, "next", undefined, budget);
  await expect(pending.promise).rejects.toMatchObject({code: "budgetExceeded", budget: "stringLength"});
  expect(asyncGeneratorRequestOwners.has(pending)).toBe(false);
});

it("refuses to capture a request whose producer is still executing", async () => {
  const budget = new Budget();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const generator = createSandboxGenerator(createGeneratorChannel(async () => {await gate; return 7;}), {async: true});
  const pending = enqueueAsyncGeneratorRequest(generator, "next", undefined, budget);
  try {
    expect(() => serialize({source:"return 7",currentAstNodeId:1,scopeChain:[{id:"module",bindings:{pending}}],callStack:[],pendingPromises:[],moduleBindings:{}}))
      .toThrow(SnapshotNotReadyError);
  } finally {
    release();
    await pending.promise;
  }
});

it("rejects generator requests when a reattached reaction fails before invoking its handler", async () => {
  const budget = new Budget();
  const source = createPendingPromiseCapability(budget);
  const capability = createPendingPromiseCapability(budget);
  const reaction = createPendingPromiseCapability(budget);
  const generator = createSandboxGenerator(createGeneratorChannel(async () => undefined), {async:true});
  generator.state = "done";
  const driver: AsyncGeneratorDriver = {generator,requests:[{method:"return",value:undefined,capability}],phase:"waiting",suspension:"await",awaitKind:"return",generation:1};
  attachPendingPromiseReaction(source.promise,reaction,
    createAsyncGeneratorHandler(driver,"fulfilled",1,budget),
    createAsyncGeneratorHandler(driver,"rejected",1,budget),budget);
  const failure = new SandboxError({budget:"steps",current:2,limit:1});
  source.rejectNative(failure);
  await expect(reaction.promise.promise).rejects.toBe(failure);
  await expect(capability.promise.promise).rejects.toBe(failure);
  expect(driver.requests).toEqual([]);
});

it.each(["request", "generator"])("accounts for queued arguments reachable through the %s", async root => {
  const budget = new Budget();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const generator = createSandboxGenerator(createGeneratorChannel(async () => {await gate;return 7;}), {async:true});
  const first = enqueueAsyncGeneratorRequest(generator,"next",undefined,budget);
  const second = enqueueAsyncGeneratorRequest(generator,"next","x".repeat(10000),budget);
  try {
    expect(measureSandboxData([root === "request" ? second : generator])).toBeGreaterThanOrEqual(10000);
  } finally {
    release();
    await Promise.all([first.promise,second.promise]);
  }
});

it("refuses to capture a running promise reaction as passive promise metadata", async () => {
  const budget = new Budget();
  const source = createPendingPromiseCapability(budget);
  const reaction = createPendingPromiseCapability(budget);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const gate = new Promise<void>(resolve => {release = resolve;});
  const handler = createSandboxClosure({call:async () => {entered();await gate;return 7;}});
  attachPendingPromiseReaction(source.promise,reaction,handler,undefined,budget);
  await source.resolve.call([1]);
  await started;
  try {
    expect(() => captureGuestHeapNode(reaction.promise, () => null)).toThrow(SnapshotNotReadyError);
  } finally {
    release();
    await reaction.promise.promise;
  }
});

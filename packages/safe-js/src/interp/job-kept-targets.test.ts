import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { SandboxJobQueue, captureJobScheduler, keepJobTarget, runAsyncPrefix, runPromiseJob, suspendJob } from "./jobs.js";
import { measureSandboxData } from "./values.js";
import { runResources, type RunResources } from "./resources.js";

it("keeps targets across internal host awaits and charges them once", async () => {
  const budget = new Budget();
  const queue = new SandboxJobQueue();
  const target = {payload: "retained"};
  await queue.run(async () => {
    keepJobTarget(target, budget);
    keepJobTarget(target, budget);
    await Promise.resolve();
    expect([...budget.retainedValues()]).toEqual([target]);
    expect(measureSandboxData(budget.retainedValues())).toBe(measureSandboxData([target]));
  });
  expect([...budget.retainedValues()]).toEqual([]);
});

it("attaches async-prefix targets to their owning execution job", async () => {
  const budget = new Budget();
  const queue = new SandboxJobQueue();
  const target = Symbol("kept");
  await queue.run(async () => {
    await runAsyncPrefix(async () => { keepJobTarget(target, budget); });
    expect([...budget.retainedValues()]).toEqual([target]);
  });
  expect([...budget.retainedValues()]).toEqual([]);
});

it("clears kept targets before other jobs and starts fresh after suspension", async () => {
  const budget = new Budget();
  const queue = new SandboxJobQueue();
  const first = {}, second = {};
  await queue.run(async () => {
    keepJobTarget(first, budget);
    const next = runPromiseJob(() => { expect([...budget.retainedValues()]).toEqual([]); });
    await suspendJob(next);
    expect([...budget.retainedValues()]).toEqual([]);
    keepJobTarget(second, budget);
    expect([...budget.retainedValues()]).toEqual([second]);
  });
  expect([...budget.retainedValues()]).toEqual([]);
});

it("clears every associated budget on abrupt completion", async () => {
  const first = new Budget(), second = new Budget();
  const queue = new SandboxJobQueue();
  const failure = new Error("stop job");
  await expect(queue.run(() => {
    keepJobTarget({}, first);
    keepJobTarget({}, second);
    throw failure;
  })).rejects.toBe(failure);
  expect([...first.retainedValues(), ...second.retainedValues()]).toEqual([]);
});

it("schedules later external notices on their captured queue without overlapping an active job", async () => {
  const queue = new SandboxJobQueue();
  const schedule = await queue.run(() => captureJobScheduler());
  const events: string[] = [];
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const active = queue.run(async () => { events.push("start"); entered(); await pending; events.push("finish"); });
  await started;
  const notice = schedule(() => { events.push("cleanup"); return 7; });
  await Promise.resolve();
  expect(events).toEqual(["start"]);
  release();
  await active;
  expect(await notice).toBe(7);
  expect(events).toEqual(["start","finish","cleanup"]);
});

it("propagates errors from a captured job without poisoning subsequent jobs", async () => {
  const schedule = await new SandboxJobQueue().run(() => captureJobScheduler());
  const failure = new Error("cleanup failed");
  await expect(schedule(() => { throw failure; })).rejects.toBe(failure);
  expect(await schedule(() => 9)).toBe(9);
});

it("restores the registering resource context when an external notice is scheduled", async () => {
  const resources: RunResources = {signal:new AbortController().signal,referenceReleases:new Set(),add:()=>{}};
  const schedule = await runResources.run(resources, () =>
    new SandboxJobQueue().run(() => captureJobScheduler()));
  expect(runResources.getStore()).toBeUndefined();
  expect(await schedule(() => runResources.getStore())).toBe(resources);
});

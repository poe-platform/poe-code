import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpawnAutonomous } from "../dist/index.js";
import { native } from "../dist/native.js";

const events = () => (async function* () { yield { event: "agent_message", text: "hello" }; })();
const timeout = () => Object.assign(new Error("inactive"), { name: "ActivityTimeoutError" });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("native driver admits the initial attempt and next retry in one transition", () => {
  const state = new native.NativeSpawnAutonomous(2);
  assert.equal(state.retry(true), true);
  assert.equal(state.retry(true), false);
  assert.throws(() => state.retry(true), /no active attempt/);
  const other = new native.NativeSpawnAutonomous(3);
  assert.equal(other.retry(false), false);
  assert.throws(() => other.retry(true), /no active attempt/);
});

test("autonomous drains events and returns the original result with default options", async () => {
  const seen = [], value = { exitCode: 0 }, marker = {};
  const run = createSpawnAutonomous(async (source) => { for await (const event of source) seen.push(event); });
  let calls = 0;
  assert.equal(await run((service, options) => {
    calls++;
    assert.equal(service, "codex");
    assert.deepEqual(options, { prompt: "hi", marker, activityTimeoutMs: 600000 });
    assert.equal(options.marker, marker);
    return { events: events(), result: Promise.resolve(value) };
  }, { service: "codex", prompt: "hi", marker }), value);
  assert.equal(calls, 1);
  assert.deepEqual(seen, [{ event: "agent_message", text: "hello" }]);
});

test("timeout retries proceed while a previous consumer is pending", async () => {
  const pending = deferred(), value = {}, failure = timeout();
  let calls = 0, consumers = 0;
  const run = createSpawnAutonomous(() => ++consumers === 1 ? pending.promise : Promise.resolve());
  assert.equal(await run(() => ({ events: events(), result: ++calls === 1 ? Promise.reject(failure) : Promise.resolve(value) }), { service: "codex" }), value);
  assert.equal(calls, 2);
  assert.equal(consumers, 2);
  pending.reject(new Error("late consumer failure is observed"));
});

test("exhausted and non-timeout errors retain their identity", async () => {
  for (const [failure, expectedCalls] of [[timeout(), 3], [new Error("failed"), 1]]) {
    let calls = 0;
    const run = createSpawnAutonomous(async () => {});
    await assert.rejects(run(() => { calls++; throw failure; }, { service: "codex" }), (error) => error === failure);
    assert.equal(calls, expectedCalls);
  }
});

test("success waits for consumption and custom attempt budgets are total attempts", async () => {
  const pending = deferred(), value = {};
  let settled = false;
  const result = createSpawnAutonomous(() => pending.promise)(() => ({ events: events(), result: Promise.resolve(value) }), { service: "codex", activityTimeoutMs: 123 });
  result.then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  pending.resolve();
  assert.equal(await result, value);
  let calls = 0;
  const failure = timeout();
  await assert.rejects(createSpawnAutonomous(async () => {})(() => { calls++; throw failure; }, { service: "codex", maxTimeoutRetries: 2 }), (error) => error === failure);
  assert.equal(calls, 2);
});

test("consumer failures observe an outstanding result rejection", async () => {
  const pending = deferred(), failure = new Error("consumer failed");
  await assert.rejects(createSpawnAutonomous(() => { throw failure; })(() => ({ events: events(), result: pending.promise }), { service: "codex" }), (error) => error === failure);
  pending.reject(new Error("late result failure is observed"));
});

test("invalid budgets reject without invoking either host callback", async () => {
  for (const maxTimeoutRetries of [-1, 0, 1.5, NaN, Infinity, null, "3", {}, true]) {
    await assert.rejects(createSpawnAutonomous(() => { assert.fail("consumer called"); })(() => { assert.fail("spawn called"); }, { service: "codex", maxTimeoutRetries }), { message: "spawnAutonomous maxTimeoutRetries must be an integer greater than or equal to 1." });
  }
});

test("consumer timeouts retry but aborts and timeout lookalikes do not", async () => {
  const failure = timeout(), value = {};
  let calls = 0, consumers = 0;
  assert.equal(await createSpawnAutonomous(() => {
    if (++consumers === 1) throw failure;
  })((_service, options) => {
    calls++;
    assert.equal(options.activityTimeoutMs, 123);
    return { events: events(), result: Promise.resolve(value) };
  }, { service: "codex", activityTimeoutMs: 123 }), value);
  assert.equal(calls, 2);
  for (const error of [{ name: "ActivityTimeoutError" }, Object.assign(new Error("cancelled"), { name: "AbortError" })]) {
    calls = 0;
    await assert.rejects(createSpawnAutonomous(async () => {})(() => { calls++; throw error; }, { service: "codex" }), (actual) => actual === error);
    assert.equal(calls, 1);
  }
});

test("concurrent autonomous calls have independent budgets and preserve options across attempts", async () => {
  const consumer = createSpawnAutonomous(async () => {}), seen = [];
  const invoke = async (budget) => {
    let calls = 0, firstOptions;
    const failure = timeout();
    await assert.rejects(consumer((_service, options) => {
      if (!firstOptions) firstOptions = options;
      assert.equal(options, firstOptions);
      assert.equal(Object.hasOwn(options, "maxTimeoutRetries"), false);
      assert.equal(Object.hasOwn(options, "service"), false);
      calls++;
      return { events: events(), result: Promise.reject(failure) };
    }, { service: "codex", maxTimeoutRetries: budget }), (error) => error === failure);
    seen.push(calls);
  };
  await Promise.all([invoke(2), invoke(4)]);
  assert.deepEqual(seen.sort(), [2, 4]);
});

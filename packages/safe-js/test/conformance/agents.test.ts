import { expect, it } from "vitest";
import { executeTest262 } from "./execute.js";

const harness = new Map([["assert.js", ""], ["sta.js", ""], ["atomicsHelper.js", ""]]);

it("runs independent agents sharing integer and BigInt locations and acknowledges broadcasts", async () => {
  const source = `/*---
flags: [onlyStrict]
includes: [atomicsHelper.js]
features: [SharedArrayBuffer, Atomics, BigInt]
---*/
$262.agent.start(\`
  $262.agent.receiveBroadcast(function(buffer, id) {
    const words = new Int32Array(buffer);
    const big = new BigInt64Array(buffer, 8);
    Atomics.store(words, 0, id);
    Atomics.add(big, 0, 9n);
    $262.agent.report(Atomics.load(big, 0));
    $262.agent.leaving();
  });
\`);
const buffer = new SharedArrayBuffer(16);
$262.agent.broadcast(buffer, 7);
let report;
while ((report = $262.agent.getReport()) === null) $262.agent.sleep(1);
if (report !== "9" || Atomics.load(new Int32Array(buffer), 0) !== 7)
  throw new Error("shared worker state");`;
  const result = await executeTest262("agents.js", source, { harness, timeoutMs: 3000 });
  expect(result).toEqual({ kind: "test", results: [{ mode: "strict", status: "passed" }] });
});

it("runs a blocking fixture without blocking the host event loop", async () => {
  let hostProgress = false;
  const timer = setTimeout(() => { hostProgress = true; }, 0);
  try {
    const source = `/*---
flags: [onlyStrict, CanBlockIsTrue]
features: [SharedArrayBuffer, Atomics]
---*/
if (Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10) !== "timed-out")
  throw new Error("blocking wait");`;
    expect(await executeTest262("blocking.js", source, { harness, timeoutMs: 1000 }))
      .toMatchObject({ results: [{ status: "passed" }] });
    expect(hostProgress).toBe(true);
  } finally { clearTimeout(timer); }
});

it("notifies independently acknowledged workers in registration order and cleans their waits", async () => {
  const { Test262Agents } = await import("./agents.js");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("agent FIFO test timed out")), 3000);
  const agents = new Test262Agents({ deadline: Date.now() + 3000 }, error => controller.abort(error));
  const report = async () => {
    let value;
    while ((value = agents.getReport()) === null) {
      controller.signal.throwIfAborted();
      await new Promise<void>(resolve => setTimeout(resolve, 1));
    }
    return value;
  };
  const interrupted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  try {
    await Promise.race([interrupted, (async () => {
      // Start fresh workers together; registration order is controlled by broadcasts,
      // not by serial worker startup or interpreted polling in a third realm.
      await Promise.all([1, 2].map(id => agents.start(`
        ${id === 2 ? "$262.agent.receiveBroadcast(function() {});" : ""}
        $262.agent.receiveBroadcast(async function(buffer) {
          const wait = Atomics.waitAsync(new Int32Array(buffer), 0, 0);
          $262.agent.report("${id}-ready");
          $262.agent.report("${id}:" + await wait.value);
          $262.agent.leaving();
        });
      `)));
      const buffer = new SharedArrayBuffer(4);
      await agents.broadcast(buffer, 0);
      expect(await report()).toBe("1-ready");
      // Worker one must acknowledge while its first callback is still suspended.
      await agents.broadcast(buffer, 0);
      expect(await report()).toBe("2-ready");
      const words = new Int32Array(buffer);
      expect(Atomics.notify(words, 0, 1)).toBe(1);
      expect(await report()).toBe("1:ok");
      expect(Atomics.notify(words, 0, 1)).toBe(1);
      expect(await report()).toBe("2:ok");
      expect(Atomics.notify(words, 0)).toBe(0);
    })()]);
  } finally {
    clearTimeout(timeout);
    controller.abort(new Error("agent FIFO test finished"));
    await agents.dispose();
  }
});

it.each(["Promise.resolve()", "new Promise(resolve => setTimeout(resolve, 1))"])("propagates an asynchronous agent failure after %s", async suspension => {
  const source = `/*---
flags: [onlyStrict]
includes: [atomicsHelper.js]
---*/
$262.agent.start(\`
  $262.agent.receiveBroadcast(async function() {
    await ${suspension};
    throw new Error("agent failed after suspension");
  });
\`);
$262.agent.broadcast(new SharedArrayBuffer(4), 0);
while ($262.agent.getReport() === null) $262.agent.sleep(1);`;
  expect(await executeTest262("agent-error.js", source, { harness, timeoutMs: 3000 }))
    .toMatchObject({ results: [{ status: "failed", reason: "host-error",
      detail: { message: expect.stringContaining("agent failed after suspension") } }] });
});

it("terminates a child with an acknowledged pending wait without leaving a native waiter", async () => {
  const { Test262Agents } = await import("./agents.js");
  let failure: Error | undefined;
  const agents = new Test262Agents({}, error => { failure = error; });
  const buffer = new SharedArrayBuffer(4);
  try {
    await agents.start(`$262.agent.receiveBroadcast(async function(buffer) {
      const wait = Atomics.waitAsync(new Int32Array(buffer), 0, 0);
      $262.agent.report("registered");
      await wait.value;
      $262.agent.report("unexpected settlement");
    });`);
    await agents.broadcast(buffer, 0);
    let report;
    while ((report = agents.getReport()) === null) {
      if (failure) throw failure;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    expect(report).toBe("registered");
  } finally { await agents.dispose(); }
  expect(Atomics.notify(new Int32Array(buffer), 0)).toBe(0);
  expect(failure).toBeUndefined();
});

it("schedules conformance timers through the host event loop and disposes pending callbacks", async () => {
  let hostProgress = false;
  const timer = setTimeout(() => { hostProgress = true; }, 0);
  try {
    const source = `/*---
flags: [onlyStrict, async]
---*/
setTimeout(function() { print("Test262:AsyncTestComplete"); }, 1);`;
    const timerHarness = new Map([...harness, ["doneprintHandle.js", ""]]);
    expect(await executeTest262("timer.js", source, { harness: timerHarness, timeoutMs: 1000 }))
      .toEqual({ kind: "test", results: [{ mode: "strict", status: "passed" }] });
    expect(hostProgress).toBe(true);
  } finally { clearTimeout(timer); }
});

it("reports an owned timer exception as a host failure", async () => {
  const source = `/*---
flags: [onlyStrict, async]
---*/
setTimeout(function() { throw new Error("timer failed"); }, 0);`;
  expect(await executeTest262("timer-error.js", source, {
    harness: new Map([...harness, ["doneprintHandle.js", ""]]), timeoutMs: 1000
  })).toMatchObject({ results: [{ status: "failed", reason: "host-error" }] });
});

it("does not turn a handled callback rejection into an agent failure", async () => {
  const source = `/*---
flags: [onlyStrict]
---*/
$262.agent.start(\`
  $262.agent.receiveBroadcast(function() {
    const result = Promise.reject(new Error("handled rejection"));
    result.catch(function() {});
    setTimeout(function() { $262.agent.report("handled"); $262.agent.leaving(); }, 1);
    return result;
  });
\`);
$262.agent.broadcast(new SharedArrayBuffer(4), 0);
let report;
while ((report = $262.agent.getReport()) === null) $262.agent.sleep(1);
if (report !== "handled") throw new Error("missing handled report");`;
  expect(await executeTest262("handled-agent.js", source, { harness, timeoutMs: 3000 }))
    .toEqual({ kind: "test", results: [{ mode: "strict", status: "passed" }] });
});

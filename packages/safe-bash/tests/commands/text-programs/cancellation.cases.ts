import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { cancelTurn, scheduleTurn } from "../../../src/contracts/yield.js";
import { createTextProgramCommands } from "../../../src/commands/text-programs/index.js";
import { Budget } from "../../../src/commands/text-programs/shared.js";
import { makeFileSystem } from "./helpers.js";

const originalNow = performance.now;

async function checkpointFixture(context: TestContext, fallback = false) {
  const fs = await makeFileSystem();
  const clock = { now: 100, forbidden: false };
  const controller = new AbortController();
  context.mock.method(performance, "now", () => {
    if (clock.forbidden) assert.fail("aborted checkpoint must not read the clock");
    return clock.now;
  });
  if (fallback) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
    assert.ok(descriptor);
    Object.defineProperty(globalThis, "setImmediate", { ...descriptor, value: undefined });
    context.after(() => Object.defineProperty(globalThis, "setImmediate", descriptor));
  }
  const budget = new Budget({
    command: "checkpoint", args: [], cwd: "/work", fs, env: {}, signal: controller.signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  }, {});
  return { budget, clock, controller };
}

function watchTurn(context: TestContext, callback?: () => void) {
  const marker = { ran: false };
  const handle = scheduleTurn(() => { marker.ran = true; callback?.(); });
  context.after(() => cancelTurn(handle));
  return marker;
}

test("text-program checkpoint does not yield below both thresholds", async context => {
  const { budget, clock } = await checkpointFixture(context);
  const marker = watchTurn(context);
  clock.now = 124;
  await budget.checkpoint();
  assert.equal(marker.ran, false);
});

for (const fallback of [false, true]) {
  test(`text-program checkpoint yields at 25ms before call 256: timer fallback=${fallback}`, async context => {
    const { budget, clock } = await checkpointFixture(context, fallback);
    const marker = watchTurn(context);
    clock.now = 125;
    await budget.checkpoint();
    assert.equal(marker.ran, true);
  });

  test(`text-program checkpoint retains call 256 with a stationary clock: timer fallback=${fallback}`, async context => {
    const { budget } = await checkpointFixture(context, fallback);
    const marker = watchTurn(context);
    for (let count = 0; count < 255; count++) await budget.checkpoint();
    assert.equal(marker.ran, false);
    await budget.checkpoint();
    assert.equal(marker.ran, true);
  });
}

test("text-program checkpoint resets elapsed time after the completed yield", async context => {
  const { budget, clock } = await checkpointFixture(context);
  const first = watchTurn(context, () => { clock.now = 1000; });
  clock.now = 125;
  await budget.checkpoint();
  assert.equal(first.ran, true);
  const next = watchTurn(context);
  clock.now = 1024;
  await budget.checkpoint();
  assert.equal(next.ran, false);
  clock.now = 1025;
  await budget.checkpoint();
  assert.equal(next.ran, true);
});

test("text-program checkpoint keeps cumulative count cadence after an elapsed yield", async context => {
  const { budget, clock } = await checkpointFixture(context);
  const first = watchTurn(context);
  clock.now = 125;
  await budget.checkpoint();
  assert.equal(first.ran, true);
  const next = watchTurn(context);
  for (let count = 1; count < 255; count++) await budget.checkpoint();
  assert.equal(next.ran, false);
  await budget.checkpoint();
  assert.equal(next.ran, true);
});

for (const reason of [false, null, 0, ""]) {
  test(`text-program checkpoint preserves already-aborted reason ${JSON.stringify(reason)}`, async context => {
    const { budget, clock, controller } = await checkpointFixture(context);
    controller.abort(reason);
    clock.forbidden = true;
    const marker = watchTurn(context);
    await assert.rejects(budget.checkpoint(), error => Object.is(error, reason));
    assert.equal(marker.ran, false);
  });

  for (const elapsed of [false, true]) {
    test(`text-program checkpoint preserves during-yield reason ${JSON.stringify(reason)}: elapsed=${elapsed}`, async context => {
      const { budget, clock, controller } = await checkpointFixture(context);
      if (elapsed) clock.now = 125;
      else for (let count = 0; count < 255; count++) await budget.checkpoint();
      watchTurn(context, () => controller.abort(reason));
      await assert.rejects(budget.checkpoint(), error => Object.is(error, reason));
    });
  }
}

test("text-program checkpoint timer fallback delivers elapsed-yield cancellation", async context => {
  const { budget, clock, controller } = await checkpointFixture(context, true);
  clock.now = 125;
  watchTurn(context, () => controller.abort(null));
  await assert.rejects(budget.checkpoint(), error => Object.is(error, null));
});

test("text-program checkpoint restores the original clock after fixtures", () => {
  assert.equal(performance.now, originalNow);
});

for (const elapsed of [false, true]) test(`text-program synchronous checkpoint returns cancellable work only at its threshold: elapsed=${elapsed}`, async context => {
  const { budget, clock, controller } = await checkpointFixture(context);
  const calls = elapsed ? 1 : 255;
  for (let count = 0; count < calls; count++) assert.equal(budget.checkpointSync(), undefined);
  if (elapsed) clock.now = 125;
  watchTurn(context, () => controller.abort(false));
  const pending = budget.checkpointSync();
  assert.ok(pending instanceof Promise);
  await assert.rejects(pending, error => error === false);
});

for (const [tool, args, expected] of [
  ["sed", ["s/a/x/"], "xb\n"],
  ["sed", ["-E", "s/(a|b)/x/"], "xb\n"],
  ["sed", ["s/^a/x/;s/b/y/"], "xy\n"],
  ["awk", ["{ value++; print value }"], "1\n"],
] as const) for (const cacheState of tool === "sed" ? ["cold", "warm"] : ["cold"]) test(`${tool} awaits every started checkpoint through ${args.join(" ")}: ${cacheState} program`, async context => {
  const fs = await makeFileSystem();
  const command = createTextProgramCommands().find(item => item.name === tool)!;
  let calls = 0;
  let rejectAt = Infinity;
  let reason: unknown;
  let controller = new AbortController();
  const pendingCheckpoints: Promise<void>[] = [];
  const stdout: Uint8Array[] = [];
  let execution = 0;
  const execute = () => command.execute({
    command: tool,
    // Cold runs need distinct source keys; warm runs share one prepared program.
    args: tool === "sed" ? [...args.slice(0, -1), `${args.at(-1)}\n# checkpoint-${cacheState}-${cacheState === "cold" ? ++execution : 0}`] : args,
    cwd: "/work", env: {}, fs, signal: controller.signal,
    stdin: toByteSource("ab\n"), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write() {} },
  });
  context.mock.method(Budget.prototype, "checkpointSync", () => {
    if (++calls !== rejectAt) return undefined;
    const pending = new Promise<void>((_resolve, reject) => {
      scheduleTurn(() => { controller.abort(reason); reject(reason); });
    });
    // Observe the injected failure independently so a lost promise is reported
    // as an incorrect command result rather than leaking into another case.
    void pending.catch(() => {});
    pendingCheckpoints.push(pending);
    return pending;
  });
  if (cacheState === "warm") {
    assert.equal((await execute()).exitCode, 0);
    calls = 0;
    stdout.length = 0;
  }
  const baseline = await execute();
  assert.equal(baseline.exitCode, 0);
  assert.equal(Buffer.concat(stdout).toString(), expected);
  const checkpoints = calls;
  assert.ok(checkpoints > 0);
  for (reason of [false, null]) {
    for (rejectAt = 1; rejectAt <= checkpoints; rejectAt++) {
      calls = 0;
      controller = new AbortController();
      const [outcome] = await Promise.allSettled([execute()]);
      await Promise.allSettled(pendingCheckpoints.splice(0));
      assert.ok(calls >= rejectAt, `checkpoint ${rejectAt} must be reached in the ${cacheState} program`);
      assert.deepEqual(outcome, { status: "rejected", reason }, `checkpoint ${rejectAt} must retain ${String(reason)}`);
    }
  }
});

for (const tool of ["sed", "awk"] as const) {
  for (const blocked of ["stdin", "stdout", "stderr", "loop"] as const) {
    test(`${tool} cancels blocked ${blocked} without waiting for host cooperation`, { timeout: 2000 }, async () => {
      const controller = new AbortController();
      const fs = await makeFileSystem();
      const command = createTextProgramCommands({ maxSteps: 1_000_000_000 }).find(definition => definition.name === tool)!;
      const never = () => new Promise<void>(() => {});
      const source: ByteSource = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}) }; } };
      const args = blocked === "stderr" ? ["--unsupported"] : blocked === "loop" ? [tool === "sed" ? ":repeat;b repeat" : "BEGIN { while(1) value++ }"] : [tool === "sed" ? "p" : "{print}"];
      const reason = new Error("oracle cancellation");
      const timer = setTimeout(() => controller.abort(reason), 10);
      try {
        await assert.rejects(async () => command.execute({
          command: tool, args, cwd: "/work", fs, env: {}, signal: controller.signal,
          stdin: blocked === "stdin" ? source : toByteSource("line\n"),
          stdout: { write: blocked === "stdout" ? never : async () => {} },
          stderr: { write: blocked === "stderr" ? never : async () => {} },
        }), error => error === reason);
      } finally { clearTimeout(timer); }
    });
  }
}

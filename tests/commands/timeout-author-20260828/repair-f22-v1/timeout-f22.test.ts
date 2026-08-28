import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, Shell, createMemoryFileSystem } from "../../../../src/index.js";
import { createTimeoutCommand } from "../../../../src/commands/timeout/index.js";
import { ManualScheduler, captureContext, gate, turn } from "../fixtures.js";

function activeTimeouts(): number {
  return process.getActiveResourcesInfo().filter(resource => resource === "Timeout").length;
}

test("F22 default captured Node clock returns early child status through direct cleanup and actual Shell", async () => {
  const before = activeTimeouts();
  let directCalls = 0;
  const direct = captureContext(["1", "child"], {
    invoke: async () => {
      directCalls++;
      return { exitCode: 7 };
    },
  });
  assert.deepEqual(await createTimeoutCommand().execute(direct.context), { exitCode: 7 });
  assert.equal(directCalls, 1);
  assert.equal(direct.cleanups.length, 1);
  assert.deepEqual(await Promise.allSettled(direct.cleanups.map(cleanup => cleanup())), [
    { status: "fulfilled", value: undefined },
  ]);
  assert.equal(direct.stdout(), "");
  assert.equal(direct.stderr(), "");

  const commands = new CommandRegistry([createTimeoutCommand(), {
    name: "child",
    execute: () => ({ exitCode: 7 }),
  }]);
  const shell = new Shell({ fs: createMemoryFileSystem(), commands });
  try {
    const result = await shell.exec("timeout 1 child");
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    await shell.dispose();
  }
  await turn();
  assert.equal(activeTimeouts(), before);
});

test("custom receiver snapshot, one-handle chunks, cancellation, and cleanup remain unchanged", async () => {
  const scheduler = new ManualScheduler();
  const childClose = gate();
  let admitted!: () => void;
  const childAdmitted = new Promise<void>(resolve => { admitted = resolve; });
  let observedReason: unknown;
  const capture = captureContext(["2s", "child"], {
    invoke: async (_command, _args, options) => {
      admitted();
      const signal = options!.signal!;
      await new Promise<void>(resolve => signal.addEventListener("abort", () => {
        observedReason = signal.reason;
        resolve();
      }, { once: true }));
      await childClose.promise;
      throw signal.reason;
    },
  });
  const command = createTimeoutCommand({ scheduler, maxTimerMilliseconds: 1000 });
  scheduler.now = () => { throw new Error("replacement now called"); };
  scheduler.setTimeout = () => { throw new Error("replacement setTimeout called"); };
  scheduler.clearTimeout = () => { throw new Error("replacement clearTimeout called"); };

  const pending = Promise.resolve(command.execute(capture.context));
  await childAdmitted;
  assert.deepEqual(scheduler.setCalls, [1000]);
  assert.equal(scheduler.pending, true);
  scheduler.fire(500);
  assert.deepEqual(scheduler.setCalls, [1000, 1000]);
  assert.deepEqual(scheduler.clearCalls, [0]);
  assert.equal(scheduler.pending, true);
  scheduler.fire(1000);
  assert.deepEqual(scheduler.setCalls, [1000, 1000, 500]);
  assert.deepEqual(scheduler.clearCalls, [0, 0]);
  assert.equal(scheduler.pending, true);
  scheduler.fire(500);
  await turn();
  assert.notEqual(observedReason, undefined);
  assert.equal(scheduler.pending, true);
  childClose.release();
  assert.deepEqual(await pending, { exitCode: 124 });
  assert.deepEqual(scheduler.clearCalls, [0, 0, 0]);
  assert.equal(scheduler.pending, false);
  assert.equal(capture.cleanups.length, 1);
  assert.ok(scheduler.receivers.length > 0);
  assert.ok(scheduler.receivers.every(receiver => receiver === scheduler));
});

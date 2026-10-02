import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import type { CommandContext } from "safe-bash-contracts";
import assert from "node:assert/strict";
import test from "node:test";
import { createYesCommand, createYesCommands, yesCommands, settings } from "./index.js";

test("yes command exports standard contract", () => {
  const cmd = createYesCommand();
  assert.equal(cmd.name, "yes");
  assert.equal(createYesCommands().length, 1);
  assert.equal(yesCommands().name, "yes-commands");
  assert.equal(settings({ maxRecordBytes: 1024 }).maxRecordBytes, 1024);
});

test("yes settings disable the record ceiling unless configured", () => {
  assert.equal(settings().maxRecordBytes, Infinity);
  assert.equal(settings({ maxRecordBytes: Infinity }).maxRecordBytes, Infinity);
  assert.equal(settings().chunkBytes, 16384);
});


test("yes yields through the host checkpoint between chunks and propagates cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("consumer finished");
  let writes = 0;
  let checkpoints = 0;
  registerYieldCheckpoint(controller.signal, () => { checkpoints++; });
  const context = {
    command: "yes", args: [], env: {}, signal: controller.signal,
    stdout: { async write(bytes: Uint8Array) {
      assert.equal(new TextDecoder().decode(bytes), "y\ny\n");
      if (++writes === 2) controller.abort(reason);
    } },
    stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  } as unknown as CommandContext;
  await assert.rejects(async () => createYesCommand({ chunkBytes: 4 }).execute(context), error => error === reason);
  assert.equal(writes, 2);
  assert.equal(checkpoints, 1);
});

test("yes command accepts unlimited and large finite record ceilings", () => {
  for (const maxRecordBytes of [Infinity, 16 * 1024 * 1024 + 1, Number.MAX_SAFE_INTEGER]) {
    assert.doesNotThrow(() => createYesCommand({ maxRecordBytes }));
  }
  for (const maxRecordBytes of [-Infinity, NaN, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createYesCommand({ maxRecordBytes }), RangeError);
  }
  assert.throws(() => createYesCommand({ chunkBytes: Infinity }), RangeError);
});

test("yes emits records larger than one MiB with omitted or explicit unlimited ceiling", async () => {
  for (const options of [{}, { maxRecordBytes: Infinity }]) {
    const controller = new AbortController();
    const reason = new Error("consumer finished");
    let written = 0;
    const context = {
      command: "yes", args: ["x".repeat(1024 * 1024 + 1)], env: {}, signal: controller.signal,
      stdout: { async write(bytes: Uint8Array) {
        written += bytes.length;
        assert.equal(bytes[0], 120);
        controller.abort(reason);
      } },
      stderr: { async write() { assert.fail("unexpected record limit diagnostic"); } },
    } as unknown as CommandContext;
    await assert.rejects(async () => createYesCommand(options).execute(context), error => error === reason);
    assert.ok(written > 0);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createStructuredCommands, FsError, MemoryFileSystem, type CommandContext } from "../../../../src/index.js";
import { JqError } from "../../../../src/commands/structured/limits.js";
import { collector } from "./harness.js";

async function execute(overrides: Partial<CommandContext>) {
  const stdout = collector();
  const stderr = collector();
  const command = createStructuredCommands().find(command => command.name === "jq")!;
  const result = await command.execute({ command: "jq", args: ["-c", "."], fs: new MemoryFileSystem(), cwd: "/", env: {}, stdin: (async function* () { yield Buffer.from("1\n2\n"); })(), stdinIsDefault: false, stdout: stdout.sink, stderr: stderr.sink, signal: AbortSignal.timeout(1500), ...overrides });
  return { status: result.exitCode, stdoutHex: stdout.hex(), stderrHex: stderr.hex() };
}

for (const failure of [new Error("input failed"), new JqError("input failed")]) {
  test(`input ${failure.constructor.name} never becomes a recoverable per-record error`, async () => {
    let reads = 0;
    let closed = false;
    const stdin = (async function* () {
      try { reads++; yield Buffer.from("1\n"); reads++; throw failure; }
      finally { closed = true; }
    })();
    if (failure instanceof JqError) {
      const result = await execute({ stdin });
      assert.equal(result.status, 5);
      assert.equal(result.stdoutHex, "310a");
    } else await assert.rejects(execute({ stdin }), error => error === failure);
    assert.equal(reads, 2);
    assert.equal(closed, true);
  });
}

for (const failure of [new Error("stderr failed"), new FsError("EPIPE"), new FsError("EIO"), new JqError("stderr failed")]) {
  test(`runtime stderr ${failure.constructor.name}:${failure.message} is not retried`, async () => {
    let writes = 0;
    let reads = 0;
    let closed = false;
    const stdin = (async function* () {
      try { reads++; yield Buffer.from("null\n"); reads++; yield Buffer.from("null\n"); }
      finally { closed = true; }
    })();
    await assert.rejects(execute({ args: ["-c", "1/0"], stdin, stderr: { async write() { writes++; throw failure; } } }), error => error === failure);
    assert.equal(writes, 1, "failed host stderr write must not be retried by filter recovery");
    assert.equal(reads, 1);
    assert.equal(closed, true);
  });
}

test("a later stderr failure cannot replay a successfully written diagnostic", async () => {
  const failure = new FsError("EIO");
  const writes: string[] = [];
  const stdin = (async function* () { yield Buffer.from("null null\n"); })();
  await assert.rejects(execute({ args: ["-c", "1/0"], stdin, stderr: { async write(bytes) { writes.push(Buffer.from(bytes).toString()); if (writes.length >= 2) throw failure; } } }), error => error === failure);
  assert.equal(writes.length, 2, JSON.stringify(writes));
});

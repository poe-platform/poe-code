import assert from "node:assert/strict";
import { test } from "node:test";
import { Session, records, settings } from "../../src/commands/stream-format/shared.js";
import { Budget, settings as tableSettings } from "../../src/commands/table-text/internal.js";
import type { CommandContext } from "../../src/contracts/index.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

function context(signal = new AbortController().signal) {
  const chunks: Uint8Array[] = [];
  const command: CommandContext = {
    command: "output-buffering", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(), signal,
    stdin: (async function* () { yield* []; })(),
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write() { assert.fail("unexpected stderr"); } },
  };
  return { chunks, command };
}

test("stream records scan slices and preserve byte charging across reused input chunks", async t => {
  const { command } = context();
  const session = new Session(command, settings({}));
  let calls = 0, charged = 0;
  const step = session.step.bind(session);
  t.mock.method(session, "step", async (count = 1) => { calls++; charged += count; await step(count); });
  const shared = Uint8Array.of(255, 0, 10, 97);
  const source = (async function* () { yield shared; shared.set([98, 10, 10, 99]); yield shared; })();
  const actual = [];
  for await (const record of records(source, session)) actual.push(record);
  assert.deepEqual(actual, [
    { bytes: Uint8Array.of(255, 0), terminated: true },
    { bytes: Uint8Array.of(97, 98), terminated: true },
    { bytes: new Uint8Array(), terminated: true },
    { bytes: Uint8Array.of(99), terminated: false },
  ]);
  assert.equal(charged, 8);
  assert.ok(calls <= 5, `scanner awaited ${calls} times for 8 bytes`);
  await session.close();
});

test("stream and table output coalesce small writes and flush the final fragment", async () => {
  const first = context();
  const session = new Session(first.command, settings({}));
  for (let index = 0; index < 1000; index++) await session.output(Uint8Array.of(index % 256));
  await session.buffered.flush();
  await session.close();
  assert.equal(first.chunks.length, 1);
  assert.equal(first.chunks[0]!.length, 1000);
  const second = context();
  const budget = new Budget(second.command, tableSettings({}));
  for (let index = 0; index < 1000; index++) await budget.output([Uint8Array.of(65), Uint8Array.of(10)]);
  await budget.flushOutput();
  assert.ok(second.chunks.length <= 2);
  assert.equal(Buffer.concat(second.chunks).length, 2000);
});

test("stream checkpoints propagate from the caller and preserve exact cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("checkpoint stopped");
  registerYieldCheckpoint(controller.signal, () => { controller.abort(reason); });
  const session = new Session(context(controller.signal).command, settings({}));
  await assert.rejects(async () => session.step(4096), error => error === reason);
});

import assert from "node:assert/strict";
import test from "node:test";
import { FsError, toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget, RecordReader, settings, argument } from "./index.js";

test("record reader owns reusable chunks and enforces canonical limits", async () => {
  const bytes = Buffer.from("a\nb\n");
  const source = (async function* () { yield bytes; bytes.fill(120); })();
  const context = { args: [], signal: new AbortController().signal } as unknown as CommandContext;
  const reader = new RecordReader(source, 10, new Budget(context, settings({})), context.signal);
  assert.equal(Buffer.from((await reader.next())!).toString(), "a");
  assert.equal(Buffer.from((await reader.next())!).toString(), "b");
  assert.equal(await reader.next(), undefined);
  await reader.close();
  const bounded = new RecordReader(toByteSource("long\n"), 10, new Budget(context, settings({ limits: { maxRecordBytes: 2 } })), context.signal);
  await assert.rejects(bounded.next(), error => error instanceof FsError && error.code === "EFBIG");
  await bounded.close();
});

test("argument handling and finite limits preserve validation", () => {
  assert.deepEqual(argument(["-s", ":"], 0, undefined, "-s"), [":", 1]);
  assert.throws(() => argument(["-s"], 0, undefined, "-s"), error => error instanceof FsError && error.code === "EINVAL");
  assert.throws(() => settings({ limits: { maxRecordBytes: 0 } }), RangeError);
});

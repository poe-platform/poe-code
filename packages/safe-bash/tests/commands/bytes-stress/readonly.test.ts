import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { bytes, memory, run, wrap } from "./helpers.js";

const payload = bytes(4099);
const archive = gzipSync(payload);

for (const [command, args] of [
  ["gzip", ["payload.bin"]], ["gzip", ["-k", "payload.bin"]], ["gzip", ["-f", "payload.bin"]],
  ["gunzip", ["input.gz"]], ["gunzip", ["-k", "input.gz"]], ["gzip", ["-df", "input.gz"]],
] as const) test(`readonly preflight reports EROFS without touching bytes: ${command} ${args.join(" ")}`, async () => {
  const data = { "payload.bin": payload, "input.gz": archive, input: Buffer.from("PROTECTED") };
  const backing = await memory({ files: data });
  let attemptedWrites = 0;
  let streamed = 0;
  const readonly = new ReadOnlyFileSystem(backing);
  const fs = wrap(readonly, {
    async mkdir() { attemptedWrites++; throw new Error("must not attempt staging"); },
    async writeStream() { attemptedWrites++; throw new Error("must not attempt writes"); },
    async *readStream() { streamed++; throw new Error("must not consume file before readonly denial"); },
  });
  const actual = await run(command, args, "", {}, { fs });
  assert.equal(actual.exitCode, 1);
  assert.match(actual.stderr.toString(), /EROFS/u);
  assert.doesNotMatch(actual.stderr.toString(), /ENOTSUP/u);
  assert.equal(actual.stdout.length, 0);
  assert.equal(attemptedWrites, 0);
  assert.equal(streamed, 0);
  assert.deepEqual((await backing.readdir("/work")).map(entry => entry.name).sort(), Object.keys(data).sort());
  for (const [name, value] of Object.entries(data)) assert.deepEqual(Buffer.from(await backing.readFile(`/work/${name}`)), value);
});

test("readonly named preflight prevents earlier stdin operand from producing output", async () => {
  const fs = new ReadOnlyFileSystem(await memory({ files: { "payload.bin": payload } }));
  let consumed = false;
  const result = await run("gzip", ["-", "payload.bin"], { async *[Symbol.asyncIterator]() { consumed = true; yield payload; } }, {}, { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr.toString(), /EROFS/u);
  assert.equal(consumed, false);
  assert.equal(result.stdout.length, 0);
});

test("readonly policy is not inferred merely from missing streaming writes", async () => {
  const backing = await memory({ files: { "payload.bin": payload } });
  const writableButUnsupported = wrap(backing, { capabilities: { ...backing.capabilities, readOnly: false, streamingWrite: false } });
  const unsupported = await run("gzip", ["payload.bin"], "", {}, { fs: writableButUnsupported });
  assert.match(unsupported.stderr.toString(), /ENOTSUP/u);
  const declaredReadonly = wrap(writableButUnsupported, { capabilities: { ...writableButUnsupported.capabilities, readOnly: true } });
  const denied = await run("gzip", ["payload.bin"], "", {}, { fs: declaredReadonly });
  assert.match(denied.stderr.toString(), /EROFS/u);
});

test("readonly gzip stdout, gunzip stdout and validation remain byte-correct", async () => {
  const backing = await memory({ files: { "payload.bin": payload, "input.gz": archive } });
  const fs = new ReadOnlyFileSystem(backing);
  const compressed = await run("gzip", ["-c", "payload.bin"], "", {}, { fs });
  assert.equal(compressed.exitCode, 0, compressed.stderr.toString());
  assert.deepEqual(gunzipSync(compressed.stdout), payload);
  for (const [command, args, expected] of [["gunzip", ["-c", "input.gz"], payload], ["gzip", ["-t", "input.gz"], Buffer.alloc(0)], ["zcat", ["input.gz"], payload]] as const) {
    const result = await run(command, args, "", {}, { fs });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.deepEqual(result.stdout, expected);
  }
  assert.deepEqual((await backing.readdir("/work")).map(entry => entry.name).sort(), ["input.gz", "payload.bin"]);
  assert.deepEqual(Buffer.from(await backing.readFile("/work/payload.bin")), payload);
  assert.deepEqual(Buffer.from(await backing.readFile("/work/input.gz")), archive);
});

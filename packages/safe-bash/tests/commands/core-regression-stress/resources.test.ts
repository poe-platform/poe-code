import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { FsError, type ByteSource } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { chunks, execute } from "./helpers.js";

for (const name of ["wc", "cksum", "sort"]) test(`${name}: abort blocked stdin and observe late rejection`, async () => {
  const controller = new AbortController(), reason = new FsError("EACCES", { message: "caller canceled" });
  let entered!: () => void, rejectRead!: (error: Error) => void, closed = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { entered(); return new Promise<IteratorResult<Uint8Array>>((_, reject) => { rejectRead = reject; }); },
    async return() { closed = true; return { done: true, value: undefined }; },
  }; } };
  const pending = execute(name, name === "cksum" ? ["-a", "sha256"] : [], { stdin, signal: controller.signal });
  const rejected = assert.rejects(pending, error => error === reason);
  await started;
  controller.abort(reason);
  await rejected;
  rejectRead(new Error("late input failure"));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(closed, true);
});

test("sort: owned output chunks survive awaited backpressure without aliasing", async () => {
  const input = Array.from({ length: 2500 }, (_, index) => `${2500 - index}:${"x".repeat(65)}`).join("\n") + "\n";
  const retained: Uint8Array[] = [], copies: Uint8Array[] = [];
  let writing = false;
  const result = await execute("sort", [], { stdin: chunks(Buffer.from(input), 7), stdout: { async write(bytes) {
    assert.equal(writing, false); writing = true;
    assert.ok(bytes.length <= 65536);
    retained.push(bytes); copies.push(bytes.slice());
    await new Promise(resolve => setImmediate(resolve)); writing = false;
  } } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Buffer.concat(retained), Buffer.concat(copies));
  assert.equal(Buffer.concat(retained).toString(), input.trimEnd().split("\n").sort().join("\n") + "\n");
});

test("sort: buffer failure must not publish partial replacement", async () => {
  const original = Buffer.alloc(32 * 1024 * 1024 + 1, 97);
  const fs = createMemoryFileSystem({ maxFileBytes: original.length });
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", original);
  const result = await execute("sort", ["-o", "input", "input"], { fs });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr.toString(), /EFBIG/u);
  const actual = await fs.readFile("/work/input");
  assert.equal(actual.length, original.length);
  assert.equal(createHash("sha256").update(actual).digest("hex"), createHash("sha256").update(original).digest("hex"));
  assert.equal(result.stdout.length, 0);
});

for (const args of [["-a", "not-an-algorithm"], ["--check"], ["-b"], ["--tag"]]) test(`cksum: unsupported syntax ${args.join(" ")} consumes no input`, async () => {
  let pulls = 0;
  const input = (async function* () { pulls++; yield Buffer.from("secret"); })();
  const result = await execute("cksum", args, { stdin: input });
  assert.notEqual(result.exitCode, 0);
  assert.equal(pulls, 0);
  assert.equal(result.stdout.length, 0);
});

test("cksum: streaming large binary is chunk-invariant", async () => {
  const input = Uint8Array.from({ length: 1024 * 1024 + 3 }, (_, index) => index % 256);
  const whole = await execute("cksum", ["-a", "sha512"], { stdin: chunks(input, input.length) });
  const split = await execute("cksum", ["-a", "sha512"], { stdin: chunks(input, 79) });
  assert.equal(whole.exitCode, 0); assert.equal(split.exitCode, 0);
  assert.deepEqual(whole.stdout, split.stdout);
});

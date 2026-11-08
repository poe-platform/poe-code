import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { FsError, type ByteSource } from "../../../../src/contracts/index.js";
import { JqError } from "../../../../src/commands/structured/limits.js";
import { executeBytes, bytesSource } from "../independent-increment/harness.js";

test("recovery stops at parse error instead of consuming later valid records", async () => {
  const result = await executeBytes(["-c", 'join("/")'], Buffer.from('[{}]\n{"bad":\n["later"]'));
  assert.equal(result.status, 5);
  assert.equal(result.stdoutHex, "");
  assert.match(Buffer.from(result.stderrHex, "hex").toString(), /cannot be added[\s\S]*parse error/u);
});

for (const name of ["maxResults", "maxOutputBytes", "maxSteps"] as const) test(`optional and recovery cannot swallow ${name}`, async () => {
  const result = await executeBytes(["-c", "(range(100000))?"], Buffer.from("null\nnull"), { limits: { [name]: 16 } });
  assert.equal(result.status, 5);
  assert.match(Buffer.from(result.stderrHex, "hex").toString(), new RegExp(name));
});

test("repeated runtime diagnostics are bounded even with no stdout", async () => {
  const result = await executeBytes(["-c", "1/0"], Buffer.from("null\n".repeat(1000)), { limits: { maxOutputBytes: 512 } });
  assert.equal(result.status, 5);
  assert.equal(result.stdoutHex, "");
  const stderr = Buffer.from(result.stderrHex, "hex");
  assert.ok(stderr.length <= 550);
  assert.match(stderr.toString(), /maxOutputBytes/u);
});

for (const error of [new FsError("EPIPE"), new JqError("host sink failure")]) test(`host stdout failure is never a recoverable filter error: ${error.message}`, async () => {
  let writes = 0;
  let reads = 0;
  let closed = false;
  const source: ByteSource = (async function* () {
    try { reads++; yield Buffer.from("1\n"); reads++; yield Buffer.from("2\n"); }
    finally { closed = true; }
  })();
  const running = executeBytes(["-c", "."], source, {}, { stdout: { async write() { writes++; throw error; } } });
  if (error instanceof FsError) await assert.rejects(running, failure => failure === error);
  else assert.equal((await running).status, 5);
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  assert.ok(closed);
});

test("blocked runtime stderr cancels and closes upstream", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel stderr");
  let ready!: () => void;
  let closed = false;
  const entered = new Promise<void>(resolve => { ready = resolve; });
  const source = (async function* () { try { yield Buffer.from("null\nnull\n"); } finally { closed = true; } })();
  const running = executeBytes(["-c", "1/0"], source, {}, { signal: controller.signal, stderr: { async write() { ready(); await new Promise<void>(() => {}); } } });
  const rejection = assert.rejects(running, error => error === reason);
  await entered;
  controller.abort(reason);
  await rejection;
  assert.ok(closed);
});

test("replacement expansion respects exact UTF8 value bytes", async () => {
  for (const size of [1, 2, 3]) {
    const bytes = Buffer.from("ed a0 80 0a".replaceAll(" ", ""), "hex");
    const success = await executeBytes(["-Rc", "."], bytesSource(bytes, size), { limits: { maxValueBytes: 5 } });
    assert.equal(success.status, 0);
    assert.equal(success.stdoutHex, Buffer.from('"�"\n').toString("hex"));
    const failure = await executeBytes(["-Rc", "."], bytesSource(bytes, size), { limits: { maxValueBytes: 4 } });
    assert.equal(failure.status, 5);
  }
});

test("large replacement workloads retain cooperative cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel replacements");
  const input = Buffer.alloc(3 * 1024 * 1024, 0x80);
  const running = executeBytes(["-R", "empty"], input, { limits: { maxInputBytes: 4 * 1024 * 1024, maxValueBytes: 16 * 1024 * 1024 } }, { signal: controller.signal });
  const rejection = assert.rejects(running, error => error === reason);
  await setImmediate();
  controller.abort(reason);
  await rejection;
});

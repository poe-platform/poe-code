import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../src/contracts/index.js";
import { ColumnBudget } from "../../../../src/commands/column/internal.js";
import { settings } from "../../../../src/commands/column/options.js";
import { tableOutput } from "../../../../src/commands/column/table.js";
import { deferred, run } from "../helpers.js";

test("entire absent suffix is admitted before any padding is published", async () => {
  const result = await run(["-t", "-s:"], "x\na:bbb:c\n", { limits: { maxOutputBytes: 7 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "x");
  assert.match(result.stderr, /output padding limit/);
});

test("a suffix exact-fit can publish before the following newline limit fails", async () => {
  const result = await run(["-t", "-s:"], "x\na:bbb:c\n", { limits: { maxOutputBytes: 8 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, `x${" ".repeat(7)}`);
  assert.match(result.stderr, /output limit/);
});

test("multibyte separator tail admission counts bytes rather than characters", async () => {
  const result = await run(["-t", "-s:", "-o界·"], "x\na:b:c\n", { limits: { maxOutputBytes: 11 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "x");
  assert.match(result.stderr, /output padding limit/);
});

test("work budget admits all suffix bytes before constructing its output", async () => {
  const { context } = await run();
  const chunks: Uint8Array[] = [];
  const budget = new ColumnBudget({ ...context, stdout: { async write(bytes) { chunks.push(Uint8Array.from(bytes)); } } }, settings({ limits: { maxSteps: 100, maxOutputBytes: 100_000 } }));
  await assert.rejects(tableOutput([[{ text: "x", width: 1 }]], [1, 50_000, 1], " ", budget), /work limit/);
  assert.equal(Buffer.concat(chunks).toString(), "x");
});

test("suffix metadata is admitted before allocation and zero-output tails skip all absent cells", async () => {
  const { context } = await run();
  const fail = new ColumnBudget(context, settings({ limits: { maxSteps: 10 } }));
  await assert.rejects(tableOutput([[{ text: "", width: 0 }]], Array<number>(1000).fill(0), "", fail), /work limit/);
  const chunks: Uint8Array[] = [];
  const budget = new ColumnBudget({ ...context, stdout: { async write(bytes) { chunks.push(Uint8Array.from(bytes)); } } }, settings({ limits: { maxSteps: 2500 } }));
  await tableOutput(Array.from({ length: 100 }, () => [{ text: "", width: 0 }]), Array<number>(1000).fill(0), "", budget);
  assert.equal(Buffer.concat(chunks).toString(), "\n".repeat(100));
});

test("large synthetic padding and separators emit bounded owned chunks with backpressure", async () => {
  const entered = deferred(), release = deferred();
  const chunks: Uint8Array[] = [];
  let paused = false, active = 0, writes = 0;
  const pending = run(["-t", "-s:"], `x\na:${"b".repeat(30_000)}:c\n`, {}, { stdout: { async write(bytes) {
    active++; assert.equal(active, 1); writes++;
    assert.ok(bytes.length <= 8192);
    chunks.push(bytes);
    if (!paused && bytes.length === 8192) { paused = true; entered.resolve(); await release.promise; }
    active--;
  } } });
  await entered.promise;
  const stoppedAt = writes, saved = Buffer.from(chunks.at(-1)!);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(writes, stoppedAt);
  assert.deepEqual(Buffer.from(chunks.at(-1)!), saved);
  release.resolve();
  assert.equal((await pending).exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString(), `x${" ".repeat(30_004)}\na  ${"b".repeat(30_000)}  c\n`);
  assert.deepEqual(Buffer.from(chunks[1]!), saved);
  const separated: Uint8Array[] = [];
  assert.equal((await run(["-t", "-s:", "-o", "界".repeat(4000)], "x\na:b:c\n", {}, { stdout: { async write(bytes) { assert.ok(bytes.length <= 8192); separated.push(bytes); } } })).exitCode, 0);
  assert.ok(Buffer.concat(separated).includes(Buffer.from("界".repeat(4000))));
});

test("cancellation during padding preserves reason, admitted prefix, and stops writes", async () => {
  const controller = new AbortController(), reason = new FsError("ENOENT", { message: "padding cancellation" });
  const gate = deferred(), entered = deferred();
  const chunks: Uint8Array[] = [];
  const pending = run(["-t", "-s:"], `x\na:${"b".repeat(30_000)}:c\n`, {}, { signal: controller.signal, stdout: { async write(bytes) {
    chunks.push(Uint8Array.from(bytes));
    if (bytes.length === 8192) { entered.resolve(); await gate.promise; }
  } } });
  const rejection = assert.rejects(pending, error => error === reason);
  await entered.promise;
  controller.abort(reason);
  await rejection;
  assert.equal(chunks.length, 2);
  assert.equal(Buffer.concat(chunks).toString(), `x${" ".repeat(8192)}`);
  gate.reject(new Error("late sink rejection is observed"));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test("sink failure during padding leaves the exact written prefix and no later rows", async () => {
  let writes = 0;
  const chunks: Uint8Array[] = [];
  const result = await run(["-t", "-s:"], `x\na:${"b".repeat(30_000)}:c\n`, {}, { stdout: { async write(bytes) {
    if (++writes === 3) throw new FsError("EPIPE", { message: "padding sink closed" });
    chunks.push(Uint8Array.from(bytes));
  } } });
  assert.equal(result.exitCode, 1);
  assert.equal(writes, 3);
  assert.equal(Buffer.concat(chunks).toString(), `x${" ".repeat(8192)}`);
  assert.match(result.stderr, /padding sink closed/);
});

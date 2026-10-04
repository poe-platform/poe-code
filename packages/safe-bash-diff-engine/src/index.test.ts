import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { Budget, ToolError, inspect } from "./shared.js";

for (const mode of ["stdin", "stream", "buffer", "retained", "sequential"] as const) test(`input budget accounts cumulatively for ${mode} reads`, async () => {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/file", new TextEncoder().encode("abc"));
 const totals: number[] = [];
 const view = mode === "buffer" ? new Proxy(fs, { get(target, key) {
  if (key === "readStream") return undefined;
  const value = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
 } }) : fs;
 const budget = new Budget({
  command: "diff", args: [], cwd: "/", env: {}, fs: view, stdin: toByteSource("abc"),
  stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal,
  inputBudget: { maxBytes: Infinity, check(total) { totals.push(total); } },
 }, {});
 if (mode === "sequential") {
  for await (const bytes of budget.streamSource("/file")) assert.equal(bytes.length, 3);
  for await (const bytes of budget.streamSource("/file")) assert.equal(bytes.length, 3);
 } else if (mode === "retained") {
  await inspect(budget, "/file");
  await budget.readDiff("/file");
  await budget.readDiff("/file");
 } else {
  await budget.read(mode === "stdin" ? "-" : "/file");
  await budget.read("/file");
 }
 assert.deepEqual(totals, [3, 6]);
});

test("stream admission stops on the first over-budget chunk and closes the source", async () => {
 let closed = false, reads = 0;
 const failure = new Error("input budget exceeded");
 const budget = new Budget({
  command: "patch", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
  stdin: (async function* () {
   try { for (let i = 0; i < 10; i++) { reads++; yield new Uint8Array([65]); } }
   finally { closed = true; }
  })(),
  stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal,
  inputBudget: { maxBytes: 2, check(total) { if (total > 2) throw failure; } },
 }, {});
 await assert.rejects(budget.read("-"), error => error === failure);
 assert.equal(reads, 3);
 assert.equal(closed, true);
});

test("local stream quotas preserve the collector's EFBIG diagnostic", async () => {
 const budget = new Budget({
  command: "diff", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource("abc"),
  stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal,
 }, { maxInputBytes: 2 });
 await assert.rejects(budget.read("-"), { code: "EFBIG", message: "EFBIG: output exceeds maxBytes, collectBytes" });
});
test("diff diagnostics retain the requested exit code", () => {
 const error = new ToolError("invalid patch", 1);
 assert.equal(error.message, "invalid patch");
 assert.equal(error.exitCode, 1);
});

test("first work quantum services queued cancellation with a frozen clock", async t => {
  t.mock.method(performance, "now", () => 0);
  const controller = new AbortController();
  const reason = { cancellation: "first quantum" };
  const budget = new Budget({
    command: "diff", args: [], cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() { assert.fail("unexpected stdout"); } },
    stderr: { async write() { assert.fail("unexpected stderr"); } },
    signal: controller.signal,
  }, { maxWork: 4096, maxOutputBytes: 1 });
  budget.step(4095);
  assert.equal(budget.checkpoint(), undefined);
  const turn = setImmediate(() => controller.abort(reason));
  try {
    budget.step();
    const pending = budget.checkpoint();
    assert.ok(pending instanceof Promise);
    await assert.rejects(pending, error => error === reason);
    assert.throws(() => budget.step(), error => error === reason);
  } finally { clearImmediate(turn); }
});

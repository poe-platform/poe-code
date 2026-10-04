import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { createPrCommand } from "safe-bash-command-pr";
import { Budget as PrBudget } from "safe-bash-command-pr/internal";
import { createDiffCommand } from "./index.js";

for (const failure of ["none", "storage", "sink", "cancel"] as const) test(`pagination stages through caller storage: ${failure}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  const controller = new AbortController();
  let opened = 0, closed = 0, writes = 0, total = 0, outstanding = 0, peak = 0, largest = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => assert.fail("whole file read");
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      const ordinal = ++opened;
      const handle = await target.open(...args);
      return new Proxy(handle, { get(descriptor, method) {
        if (method === "write" && ordinal === 3 && failure === "storage") return async () => { throw new Error("pagination storage failed"); };
        if (method === "close") return async () => { closed++; await descriptor.close(); };
        const value = Reflect.get(descriptor, method, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const chunk = new Uint8Array(81).fill(120); chunk[80] = 10;
  const input = { async *[Symbol.asyncIterator]() { for (let index = 0; index < 8192; index++) yield chunk; } };
  let stderr = "";
  const result = await Promise.resolve(createDiffCommand().execute({
    command: "diff", args: ["-l", "/empty", "-"], cwd: "/", env: {}, fs: view,
    stdin: input, signal: controller.signal,
    stdout: { async write(bytes) {
      largest = Math.max(largest, bytes.length);
      outstanding += bytes.length; peak = Math.max(peak, outstanding); writes++;
      try {
        await Promise.resolve();
        if (failure === "sink") throw new Error("destination failed");
        if (failure === "cancel") controller.abort(new Error("destination cancelled"));
        total += bytes.length;
      } finally { outstanding -= bytes.length; }
    } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  })).catch(error => {
    if (failure !== "cancel") throw error;
    assert.equal(error, controller.signal.reason);
    return { exitCode: 2 };
  });
  if (failure === "none") {
    assert.equal(result.exitCode, 1, stderr);
    assert.ok(total > 8192 * 81);
    assert.ok(writes > 20);
  } else assert.notEqual(result.exitCode, 1, stderr);
  if (failure === "storage") assert.equal(writes, 0, "failed pagination must publish no output");
  assert.ok(largest <= 16384, `unbounded pagination write: ${largest}`);
  assert.ok(opened >= 3, `expected source, diff output and paginated output spill, got ${opened}`);
  assert.equal(closed, opened);
  assert.ok(peak <= 16384);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["empty"]);
});


test("pagination preserves formatter bytes and the diff exit status", async t => {
  t.mock.method(Date, "now", () => 0);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  let expected = "", actual = "";
  const context = {
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  };
  const formatted = await createPrCommand().execute({
    ...context, command: "pr", args: ["-f", "-h", "diff -l /empty -"],
    stdin: toByteSource("0a1\n> changed\n"),
    stdout: { async write(bytes) { expected += new TextDecoder().decode(bytes); } },
  });
  const compared = await createDiffCommand().execute({
    ...context, command: "diff", args: ["-l", "/empty", "-"], stdin: toByteSource("changed\n"),
    stdout: { async write(bytes) { actual += new TextDecoder().decode(bytes); } },
  });
  assert.equal(formatted.exitCode, 0);
  assert.equal(compared.exitCode, 1);
  assert.equal(actual, expected);
  assert.ok(actual.includes("Page 1"));
  assert.ok(actual.endsWith("\f"));
});


test("pagination keeps the transitive formatter bounded for long lines", async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  let resident = 0, peak = 0, total = 0;
  const retain = PrBudget.prototype.retain;
  t.mock.method(PrBudget.prototype, "retain", function (this: PrBudget, amount: number) {
    retain.call(this, amount);
    resident += amount; peak = Math.max(peak, resident);
  });
  const chunk = new Uint8Array(16384).fill(120);
  const stdin = { async *[Symbol.asyncIterator]() { for (let index = 0; index < 8; index++) yield chunk; } };
  const result = await createDiffCommand().execute({
    command: "diff", args: ["-l", "/empty", "-"], cwd: "/", env: {}, fs,
    stdin, signal: new AbortController().signal,
    stdout: { async write(bytes) { assert.ok(bytes.length <= 16384); total += bytes.length; } },
    stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  });
  assert.equal(result.exitCode, 1);
  assert.ok(total > 8 * 16384);
  assert.ok(peak > 0 && peak <= 131072, `formatter retained ${peak} bytes`);
});

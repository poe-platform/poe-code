import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "../../../src/commands/diff-patch/shared.js";
import { decodeHeaderPath, safeTarget } from "../../../src/commands/diff-patch/patch-path.js";
import { unwrapPatch } from "../../../src/commands/diff-patch/patch-envelope.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { run } from "./helpers.js";

function context(): CommandContext {
  return { command: "diff", args: [], cwd: "/", env: {}, fs: new MemoryFileSystem(),
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} } };
}

test("diff/patch omitted quotas are unlimited and explicit settings are independent", () => {
  const budget = new Budget(context(), { maxFiles: 1 });
  for (const [key, value] of Object.entries(budget.limits)) assert.equal(value, key === "maxFiles" ? 1 : Infinity, key);
  for (const key of Object.keys(budget.limits)) {
    assert.equal(new Budget(context(), { [key]: Infinity }).limits[key as keyof typeof budget.limits], Infinity);
  }
  assert.throws(() => new Budget(context(), { maxInputBytes: 0 }));
  budget.file();
  assert.throws(() => budget.file(), /file\/entry limit exceeded/);
});

test("diff handles more than the former line quota, including buffered fallback", async () => {
  const text = "a\n".repeat(50_001);
  for (const options of [{}, { maxFiles: 2 }, { maxLines: 10 }]) {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/left", Buffer.from(text + "a\n"));
    await fs.writeFile("/right", Buffer.from(text + "b\n"));
    const view = new Proxy(fs, { get(target, key) {
      if (key === "readStream") return undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await run("diff", ["/left", "/right"], { fs: view, options });
    assert.equal(result.exitCode, options.maxLines ? 2 : 1, result.stderr);
  }
});

test("patch path and mail envelope have no secondary length quotas", async () => {
  const path = "a".repeat(16_385);
  assert.equal(decodeHeaderPath(`"${path}"`), path);
  assert.equal(safeTarget(path, 0), path);
  const patch = "--- old\n+++ new\n@@ -1 +1 @@\n-a\n+b\n";
  const mail = "Subject: change\n" + "X-Header: value\n".repeat(1025) + patch;
  assert.equal(await unwrapPatch(mail, new Budget(context(), {})), patch);
  const signature = "x\n".repeat(4097);
  assert.equal(await unwrapPatch(patch + "-- \n" + signature, new Budget(context(), {})), patch);
});

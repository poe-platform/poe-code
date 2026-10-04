import assert from "node:assert/strict";
import test from "node:test";
import { Budget, ToolError } from "safe-bash-diff-engine/shared";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { TargetDocuments } from "./stored-target.js";
import { applyStoredHunks } from "./stored-hunks.js";
import { parsePatch } from "./patch-formats.js";
import { filesystem, run } from "./helpers.test.js";

test("asymmetric patch matching rejects at the GNU boundary within 10,000 work units", async () => {
  const fs = await filesystem();
  const context: CommandContext = {
    command: "patch", args: [], cwd: "/work", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
  };
  const budget = new Budget(context, { maxWork: 10_000 });
  const documents = new TargetDocuments(budget);
  try {
    const original = await documents.load(toByteSource("same\n".repeat(1500)));
    const input = `--- target\n+++ target\n@@ -1,81 +1,81 @@\n${" same\n".repeat(80)}-absent\n+present\n`;
    const [patch] = await parsePatch(input, budget, undefined, undefined);
    assert(patch);
    // Strict matching stops at the rejected hunk, before copying unchanged output.
    await assert.rejects(applyStoredHunks(original, patch, 0, budget, false, { partial: false }, documents), error =>
      error instanceof ToolError && error.exitCode === 1 && error.message === "hunk 1 does not match target");
  } finally { await documents.close(); }
  assert.deepEqual(await fs.readdir("/work"), []);
});

for (const args of [[], ["--atomic"], ["--dry-run"], ["-D", "FEATURE"], ["--merge=diff3"], ["-b"]]) {
  test(`patch stages long targets with bounded reads and writes: ${args}`, async t => {
    const fs = await filesystem();
    const block = new Uint8Array(16384).fill(120);
    await fs.writeStream("/work/target", { async *[Symbol.asyncIterator]() {
      for (let index = 0; index < 32; index++) yield block;
      yield new TextEncoder().encode("\nold\n");
    } });
    const read = Budget.prototype.read;
    t.mock.method(Budget.prototype, "read", function(this: Budget, path: string, ...args: []): Promise<string> {
      assert.equal(path, "-", "target must not use the whole-file loader");
      return read.call(this, path, ...args);
    });
    let opens = 0, closed = 0, writes = 0;
    const observed = new Proxy(fs, { get(target, key) {
      if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
        opens++; const handle = await target.openReadFile(...args);
        return { ...handle,
          async read(...args: Parameters<typeof handle.read>) { assert.ok(args[1] <= 65536); return handle.read(...args); },
          async close() { closed++; await handle.close(); },
        };
      };
      if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
        if (args[2].type === "file") assert.ok(args[2].data.length <= 16384);
        const result = await target.createStagedFile(...args);
        return { ...result, writer: { ...result.writer!, async write(...args: Parameters<NonNullable<typeof result.writer>["write"]>) {
          writes++; assert.ok(args[0].length <= 16384); await Promise.resolve(); await result.writer!.write(...args);
        } } };
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await run("patch", args, { fs: observed, input: "--- target\n+++ target\n@@ -2 +2 @@\n-old\n+new\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(opens > 0); assert.equal(closed, opens);
    assert.equal(writes > 0, !args.includes("--dry-run"));
    const bytes = await fs.readFile("/work/target");
    const suffix = args.includes("--dry-run") ? "\nold\n" : args.includes("-D") ? "\n#ifndef FEATURE\nold\n#else\nnew\n#endif\n" : "\nnew\n";
    assert.equal(bytes.length, block.length * 32 + suffix.length);
    assert.ok(bytes.subarray(0, block.length * 32).every(byte => byte === 120));
    assert.equal(new TextDecoder().decode(bytes.subarray(block.length * 32)), suffix);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), args.includes("-b") ? ["target", "target.orig"] : ["target"]);
  });
}

for (const failure of ["none", "spill", "write", "finish", "publish", "cancel"] as const) {
  test(`caller storage and retained publication retire after ${failure}`, async () => {
    const fs = await filesystem();
    const block = new Uint8Array(16384).fill(120);
    await fs.writeStream("/work/target", { async *[Symbol.asyncIterator]() {
      for (let i = 0; i < 16; i++) yield block;
      yield new TextEncoder().encode("\nold\n");
    } });
    const controller = new AbortController();
    const reason = new Error("injected target failure");
    let storage = 0, storageClosed = 0, reads = 0, readsClosed = 0;
    let writes = 0, outstanding = 0, maximum = 0, publications = 0;
    const observed = new Proxy(fs, { get(target, key) {
      if (key === "readFile") return () => assert.fail("payload-wide readFile");
      if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
        storage++;
        const handle = await target.open(...args);
        return new Proxy(handle, { get(target, key) {
          if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
            assert.ok(args[0].length <= 16384);
            if (failure === "spill") throw reason;
            return target.write(...args);
          };
          if (key === "close") return async (...args: Parameters<typeof handle.close>) => { storageClosed++; await target.close(...args); };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
        reads++;
        const handle = await target.openReadFile(...args);
        return { ...handle, async close() { readsClosed++; await handle.close(); } };
      };
      if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
        assert.equal(args[2].type === "file" ? args[2].data.length : -1, 0);
        const staging = await target.createStagedFile(...args);
        return { ...staging, writer: { ...staging.writer!,
          async write(...args: Parameters<NonNullable<typeof staging.writer>["write"]>) {
            outstanding += args[0].length; maximum = Math.max(maximum, outstanding);
            try {
              await Promise.resolve();
              if (++writes === 3) {
                if (failure === "write") throw reason;
                if (failure === "cancel") controller.abort(reason);
              }
              await staging.writer!.write(...args);
            } finally { outstanding -= args[0].length; }
          },
          async finish(...args: Parameters<NonNullable<typeof staging.writer>["finish"]>) {
            if (failure === "finish") throw reason;
            return staging.writer!.finish(...args);
          },
        } };
      };
      if (key === "publishStagedFile") return async (...args: Parameters<typeof fs.publishStagedFile>) => {
        if (failure === "publish") throw reason;
        publications++; return target.publishStagedFile(...args);
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const operation = run("patch", [], { fs: observed, signal: controller.signal,
      input: "--- target\n+++ target\n@@ -2 +2 @@\n-old\n+new\n" });
    if (failure === "cancel") await assert.rejects(operation, error => error === reason);
    else assert.equal((await operation).exitCode, failure === "none" ? 0 : 2);
    assert.ok(storage > 0, "target data must spill through the caller backend");
    assert.equal(storageClosed, storage); assert.equal(readsClosed, reads);
    assert.ok(maximum <= 16384); assert.equal(outstanding, 0);
    assert.equal(publications, failure === "none" ? 1 : 0);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
    const bytes = await fs.readFile("/work/target");
    assert.equal(new TextDecoder().decode(bytes.subarray(-5)), failure === "none" ? "\nnew\n" : "\nold\n");
  });
}

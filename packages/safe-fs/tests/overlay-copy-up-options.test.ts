import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";

for (const operation of ["rm", "chmod"] as const) {
  test(`${operation} with overlay receipts copies up lower-only ancestors`, async () => {
    const lower = new MemoryFileSystem(), upper = new MemoryFileSystem();
    await lower.mkdir("/workspace/docs", { recursive: true });
    const path = "/workspace/docs/architecture.md";
    const bytes = new TextEncoder().encode("# Docs\n");
    await lower.writeFile(path, bytes);
    const fs = new OverlayFileSystem({ lower, upper });
    const ancestors = await Promise.all(["/", "/workspace", "/workspace/docs"].map(async path => ({ path, stat: await fs.lstat(path) })));
    let guarded = 0;
    const options = {
      signal: new AbortController().signal,
      ancestors,
      parent: ancestors.at(-1)!.stat,
      expected: await fs.lstat(path),
      commitGuard: () => { guarded++; return true as const; },
    };
    if (operation === "rm") {
      await fs.rm(path, { ...options, force: true });
      await assert.rejects(fs.lstat(path), { code: "ENOENT" });
      assert.equal(guarded, 0);
    } else {
      await fs.chmod(path, 0o600, options);
      assert.equal((await fs.stat(path)).mode & 0o7777, 0o600);
      assert.ok(guarded > 0);
    }
    assert.deepEqual(await lower.readFile(path), bytes);
    assert.equal((await lower.stat(path)).mode & 0o7777, options.expected.mode & 0o7777);
    assert.deepEqual((await upper.readdir("/")).map(entry => entry.name), ["workspace"]);
  });
}

test("copy-up forwards cancellation without mutation receipts and cleans aborted stages", async () => {
  const lower = new MemoryFileSystem(), upper = new MemoryFileSystem();
  await lower.mkdir("/work");
  await lower.writeFile("/work/file", new Uint8Array([1]));
  const fs = new OverlayFileSystem({ lower, upper });
  const controller = new AbortController();
  const cancelled = new Error("cancel copy-up");
  const chmod = upper.chmod.bind(upper);
  upper.chmod = async (path, mode, options) => {
    assert.deepEqual(options, { signal: controller.signal });
    controller.abort(cancelled);
    return chmod(path, mode, options);
  };
  const parent = await fs.lstat("/work");
  const options = {
    signal: controller.signal,
    parent,
    expected: await fs.lstat("/work/file"),
    ancestors: [{ path: "/", stat: await fs.lstat("/") }, { path: "/work", stat: parent }],
    commitGuard: () => { throw new Error("overlay guard reached staging"); },
  };
  await assert.rejects(fs.rm("/work/file", options), error => error === cancelled);
  assert.deepEqual(await fs.readFile("/work/file"), new Uint8Array([1]));
  assert.deepEqual(await upper.readdir("/"), []);
});

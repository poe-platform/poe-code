import assert from "node:assert/strict";
import { promises as host } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { bytes, errno, fixture } from "./helpers.js";

test("real rmdir removes empty directories and preserves rm semantics", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.mkdir("/empty");
  await assert.rejects(filesystem.rm("/empty"), errno("EISDIR"));
  await filesystem.rmdir("/empty/");
  await assert.rejects(filesystem.stat("/empty"), errno("ENOENT"));
});

for (const [path, code] of [["/missing", "ENOENT"], ["/file", "ENOTDIR"], ["/link", "ENOTDIR"],
  ["/link/", "ENOTDIR"], ["/tree", "ENOTEMPTY"], ["/", "EBUSY"], ["/empty/.", "EINVAL"]] as const) {
  test(`real rmdir ${path} reports ${code} with its exact virtual operand`, async (context) => {
    const { filesystem } = await fixture(context);
    await filesystem.mkdir("/empty");
    await filesystem.mkdir("/tree/deep", { recursive: true });
    await filesystem.writeFile("/tree/deep/child", bytes("preserved"));
    await filesystem.writeFile("/file", bytes("preserved"));
    await filesystem.symlink("/empty", "/link");
    await assert.rejects(filesystem.rmdir(path), errno(code, path, "rmdir"));
    assert.deepEqual(await filesystem.readFile("/tree/deep/child"), bytes("preserved"));
    assert.deepEqual(await filesystem.readFile("/file"), bytes("preserved"));
    assert.equal(await filesystem.readlink("/link"), "/empty");
  });
}

test("real rmdir preserves a child inserted immediately before the native deletion", async (context) => {
  const { filesystem, root } = await fixture(context);
  await filesystem.mkdir("/empty");
  const nativeRmdir = host.rmdir;
  let calls = 0;
  context.mock.method(host, "rmdir", async (path: Parameters<typeof host.rmdir>[0], options?: Parameters<typeof host.rmdir>[1]) => {
    calls++;
    assert.equal(path, join(root, "empty"));
    assert.equal(options, undefined);
    await host.writeFile(join(root, "empty", "child"), bytes("raced child"));
    return nativeRmdir(path, options);
  });
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(filesystem.rmdir("/empty"), errno("ENOTEMPTY", "/empty", "rmdir"));
  assert.equal(calls, 1);
  assert.deepEqual(await filesystem.readFile("/empty/child"), bytes("raced child"));
});

test("real rmdir preserves a directory replaced with a symlink just before native deletion", async (context) => {
  const { filesystem, root } = await fixture(context);
  await filesystem.mkdir("/empty");
  await filesystem.mkdir("/safe");
  await filesystem.writeFile("/safe/child", bytes("safe child"));
  const nativeRmdir = host.rmdir;
  context.mock.method(host, "rmdir", async (path: Parameters<typeof host.rmdir>[0], options?: Parameters<typeof host.rmdir>[1]) => {
    await nativeRmdir(path, options);
    await host.symlink(join(root, "safe"), join(root, "empty"));
    return nativeRmdir(path, options);
  });
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(filesystem.rmdir("/empty"), errno("ENOTDIR", "/empty", "rmdir"));
  assert.deepEqual(await filesystem.readFile("/safe/child"), bytes("safe child"));
  assert.equal((await filesystem.lstat("/empty")).type, "symlink");
});

test("real rmdir observes pre-aborted cancellation without removing its directory", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.mkdir("/empty");
  const reason = new Error("cancel directory removal");
  const controller = new AbortController();
  controller.abort(reason);
  await assert.rejects(filesystem.rmdir("/empty", { signal: controller.signal }), (error) => error === reason);
  assert.equal((await filesystem.stat("/empty")).type, "directory");
});

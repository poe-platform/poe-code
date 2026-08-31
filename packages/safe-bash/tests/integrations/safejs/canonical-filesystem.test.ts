import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as canonical from "poe-code/safe-fs";
import * as portable from "poe-code/safe-fs/core";
import * as node from "poe-code/safe-fs/node";
import * as sdk from "poe-code/safe-js";
import * as legacy from "poe-code/safejs";
import * as sdkCore from "poe-code/safe-js/core";
import * as legacyCore from "poe-code/safejs/core";
import { Budget, declareHostOperation, makeFsModule, run } from "poe-code/safe-js";
import { standardCommands } from "../../../src/commands/index.js";
import { safeJsCommands, type SafeJsRuntime } from "../../../src/commands/safejs/index.js";
import { Shell } from "../../../src/shell/index.js";
import * as errors from "../../../src/contracts/errors.js";
import * as io from "../../../src/contracts/io.js";
import * as memory from "../../../src/fs/memory/index.js";
import * as real from "../../../src/fs/real/index.js";
import * as mounts from "../../../src/fs/mount/index.js";
import * as overlay from "../../../src/fs/overlay/index.js";
import * as readonly from "../../../src/fs/readonly/index.js";
import * as s3 from "../../../src/fs/s3/index.js";
import * as webdav from "../../../src/fs/webdav/index.js";
import { createNodeFsBridge, makeSafeJsFsModule } from "../../../src/integrations/safejs/index.js";

test("compatibility paths expose the installed canonical constructors and neutral helpers", () => {
  for (const surface of [errors, memory, real, mounts, overlay, readonly, s3, webdav]) {
    for (const [name, value] of Object.entries(surface)) {
      assert.equal(value, Reflect.get(canonical, name), name);
    }
  }
  for (const name of ["collectBytes", "readBytes", "toByteSource"] as const) assert.equal(io[name], canonical[name], name);
  assert.equal(createNodeFsBridge, canonical.createNodeFsBridge);
});

test("the filesystem public route resolves to the authenticated checkout or published peer", async context => {
  const { resolvePeerProfile } = await import(new URL("../../plugins/qualified-current-release/peer.mjs", import.meta.url).href);
  const profile = resolvePeerProfile(fileURLToPath(new URL("../../../", import.meta.url)));
  assert.ok(profile.profile === "checkout-root" || profile.profile === "registry-release");
  for (const route of ["safe-fs", "safe-js", "safejs"]) {
    assert.equal(import.meta.resolve(`poe-code/${route}`), pathToFileURL(join(profile.directory, profile.peer.exports[`./${route}`].import)).href);
  }
  context.diagnostic(JSON.stringify({ profile: profile.profile, version: profile.peer.version, qualification: profile.qualification }));
  assert.equal(import.meta.resolve("poe-code/safe-js"), import.meta.resolve("poe-code/safejs"));
  assert.equal(import.meta.resolve("poe-code/safe-js/core"), import.meta.resolve("poe-code/safejs/core"));
  assert.equal(sdk, legacy);
  assert.equal(sdkCore, legacyCore);
  for (const surface of [portable, node]) {
    for (const name of ["FsError", "isFsError", "MemoryFileSystem", "MountFileSystem", "OverlayFileSystem", "WebDavFileSystem"] as const) {
      assert.equal(surface[name], canonical[name], name);
    }
  }
  assert.equal(node.createNodeFsBridge, createNodeFsBridge);
});

test("the runtime factory receives the original adapter with cwd and borrowed cancellation", () => {
  const adapter = memory.createMemoryFileSystem();
  const controller = new AbortController();
  const received = makeSafeJsFsModule(options => options, adapter, { cwd: "/work", signal: controller.signal });
  assert.deepEqual(received, { adapter, cwd: "/work", signal: controller.signal });
  assert.equal(Reflect.get(received, "adapter"), adapter);
  assert.equal(Object.hasOwn(received, "fs"), false);
});

test("mixed shell and canonical memory keep alias authority and exact error identity", async () => {
  const backend = memory.createMemoryFileSystem();
  await backend.writeFile("/file", new Uint8Array([1, 2, 3]));
  const view = canonical.createMountFileSystem({ root: canonical.createMemoryFileSystem(), mounts: { "/left": backend, "/right": backend } });
  assert.equal(await view.compareEntry("/left/file", view, "/right/file"), "same");
  await assert.rejects(view.copyFile("/left/file", "/right/file"), error => error instanceof errors.FsError && error instanceof canonical.FsError && error.code === "EINVAL");
  await assert.rejects(backend.readFile("/missing"), error => error instanceof canonical.FsError && errors.isFsError(error, "ENOENT"));
  const reason = new canonical.FsError("EACCES");
  await assert.rejects(backend.compareEntry("/file", backend, "/file", { signal: AbortSignal.abort(reason) }), error => error === reason);
});

test("core and Node routes preserve canonical authority through shell wrappers", async () => {
  const backend = new portable.MemoryFileSystem();
  await backend.writeFile("/file", new Uint8Array([0, 255]));
  const view = mounts.createMountFileSystem({ root: node.createMemoryFileSystem(), mounts: { "/left": backend, "/right": backend } });
  assert.equal(await portable.compareEntries(view, "/left/file", view, "/right/file"), "same");
  await assert.rejects(view.copyFile("/left/file", "/right/file"), error => error instanceof portable.FsError && error instanceof node.FsError && error instanceof errors.FsError && error.code === "EINVAL");
  const unrelated = new node.MemoryFileSystem();
  await unrelated.writeFile("/file", new Uint8Array([1]));
  assert.equal(await portable.compareEntries(backend, "/file", unrelated, "/file"), "distinct");
  assert.deepEqual(await backend.readFile("/file"), new Uint8Array([0, 255]));
});

test("published guest runtime writes and reads the original shell adapter with virtual cwd", async () => {
  const adapter = memory.createMemoryFileSystem();
  await adapter.mkdir("/work");
  const module = makeSafeJsFsModule(makeFsModule, adapter, { cwd: "/work" });
  const result = await run('import * as fs from "fs"; await fs.writeFile("file", "6869", "hex"); return await fs.readFile("file", "utf8");', { modules: { fs: module } });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.returnValue, "hi");
  assert.deepEqual(await adapter.readFile("/work/file"), new Uint8Array([104, 105]));
});

test("published adapter factory confines aliases and preserves cancellation without native fallback", async () => {
  const backend = memory.createMemoryFileSystem();
  await backend.mkdir("/work");
  await backend.writeFile("/work/file", new Uint8Array([65]));
  const adapter = mounts.createMountFileSystem({ root: memory.createMemoryFileSystem(), mounts: { "/safe": backend, "/alias": backend } });
  const module = makeFsModule({ adapter, root: "/safe", cwd: "/alias/work" });
  assert.equal(await module.readFile("file", "utf8"), "A");
  await assert.rejects(module.writeFile("/outside", "blocked"), { code: "EACCES" });
  const reason = new Error("borrowed cancellation");
  const cancelled = makeSafeJsFsModule(makeFsModule, backend, { signal: AbortSignal.abort(reason) });
  await assert.rejects(cancelled.readFile("/work/file", "utf8"), { name: "AbortError", code: "ABORT_ERR" });
});

test("actual Shell and published SDK share virtual cwd, filesystem effects and command output", async () => {
  const adapter = memory.createMemoryFileSystem();
  await adapter.mkdir("/work");
  const runtime: SafeJsRuntime<Budget> = {
    run,
    createBudget: options => new Budget(options),
    makeFsModule,
    declareHostOperation,
  };
  const shell = new Shell({ fs: adapter, cwd: "/work" });
  shell.use(standardCommands());
  shell.use(safeJsCommands({ runtime }));
  try {
    const result = await shell.exec(`printf before > file; safejs -p -e 'import * as fs from "fs"; await fs.appendFile("file", ":guest"); return await fs.readFile("file", "utf8");'; cat file`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "before:guest\nbefore:guest");
    assert.equal(new TextDecoder().decode(await adapter.readFile("/work/file")), "before:guest");
  } finally {
    await shell.dispose();
  }
});

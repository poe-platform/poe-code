import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createMemoryFileSystem, createDeviceFileSystem, createMountFileSystem, createOverlayFileSystem, withFileSystemQuota, type FileSystem, type FileSystemCapabilities, type OpenFileOptions } from "@poe-code/safe-fs/core";
import { Shell } from "../../src/shell/index.js";
import { creationFileSystem } from "../../src/shell/umask.js";
import { bindFileOutputBudget, openFileOutput } from "../../src/contracts/filesystem-output.js";

function profile(fs: FileSystem, capabilities: FileSystemCapabilities): FileSystem {
  return new Proxy(fs, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, ...capabilities };
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
}

for (const canonical of [false, true]) for (const composition of ["plain", "mount", "nested mount", "overlay", "quota"] as const) {
  test(`actual noclobber leaves final self symlink to exclusive acquisition: ${composition}/canonical=${canonical}`, async () => {
    const backing = createMemoryFileSystem();
    await backing.symlink("loop", "/loop");
    const leaf = canonical ? backing : profile(backing, { open: false });
    const fs = composition === "mount" ? createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": leaf } })
      : composition === "nested mount" ? createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": createMountFileSystem({ root: leaf }) } })
      : composition === "overlay" ? createOverlayFileSystem({ upper: createMemoryFileSystem(), lower: leaf })
      : composition === "quota" ? withFileSystemQuota(leaf, { maxBytes: 100 }) : leaf;
    const path = composition.includes("mount") ? "/data/loop" : "/loop";
    const shell = new Shell({ fs });
    try {
      const result = await shell.exec(`set -C; : >${path}`);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `shell: line 1: ${path}: cannot overwrite existing file\n`);
      assert.equal(await backing.readlink("/loop"), "loop");
      assert.deepEqual(await backing.readdir("/"), [{ name: "loop", type: "symlink" }]);
    } finally { await shell.dispose(); }
  });
}

test("private mode views preserve exclusive backend acquisition and selected path mode hints", async () => {
  const backing = createMemoryFileSystem();
  await backing.symlink("loop", "/loop");
  const fs = creationFileSystem(createDeviceFileSystem(backing), 0o077);
  await assert.rejects(fs.open!("/loop", { access: "write", creation: "exclusive" }), { code: "EEXIST" });
  for (const flag of ["wx", "ax"] as const) {
    await assert.rejects(fs.writeFile("/loop", Uint8Array.of(1), { flag }), { code: "EEXIST" });
    await assert.rejects(fs.writeStream!("/loop", { async *[Symbol.asyncIterator]() { yield Uint8Array.of(1); } }, { flag }), { code: "EEXIST" });
  }
  const descriptor = await fs.open!("/new", { access: "write", creation: "exclusive" });
  await descriptor.write(Uint8Array.of(7), null);
  await descriptor.close();
  assert.equal((await backing.stat("/new")).mode & 0o777, 0o600);
  assert.deepEqual(await backing.readFile("/new"), Uint8Array.of(7));
  await assert.rejects(fs.open!("/missing/new", { access: "write", creation: "exclusive" }), { code: "ENOENT" });
});

for (const descriptor of [false, true]) {
  test(`exclusive output admission carries intent and retains cleanup: descriptor=${descriptor}`, async () => {
    const backing = createMemoryFileSystem();
    await backing.symlink("loop", "/loop");
    const cleanups: (() => void | Promise<void>)[] = [];
    const context = { fs: createDeviceFileSystem(backing), signal: new AbortController().signal, registerCleanup: (cleanup: () => void | Promise<void>) => { cleanups.push(cleanup); } };
    bindFileOutputBudget(context, sink => sink, (_chunk, write) => write());
    await assert.rejects(openFileOutput(context, "/loop", { flag: "wx", descriptor }), { code: "EEXIST" });
    await Promise.all(cleanups.map(cleanup => cleanup()));
    assert.equal(await backing.readlink("/loop"), "loop");
  });
}

for (const fixture of [
  { source: ": >/dev", stderr: "shell: line 1: /dev: Permission denied\n", exitCode: 1 },
  { source: "set -C; : >/dev", stderr: "shell: line 1: ENOTSUP: exclusive creation is not supported, write '/dev'\n", exitCode: 1 },
  { source: ": >/dev/null", stderr: "", exitCode: 0 },
  { source: "set -C; : >/dev/null", stderr: "shell: line 1: /dev/null: cannot overwrite existing file\n", exitCode: 1 },
  { source: ": >/dev/null/child", stderr: "shell: line 1: /dev/null/child: Not a directory\n", exitCode: 1 },
  { source: "set -C; : >/dev/null/child", stderr: "shell: line 1: /dev/null/child: Not a directory\n", exitCode: 1 },
]) {
  test(`source intent preserves actual device diagnostic ordering: ${fixture.source}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    try {
      const result = await shell.exec(fixture.source);
      assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: fixture.exitCode, stdout: "", stderr: fixture.stderr });
    } finally { await shell.dispose(); }
  });
}

for (const canonical of [false, true]) for (const permissions of [false, undefined]) {
  test(`actual selected mount acquisition keeps permissionless/unknown mode hints: ${canonical}/${permissions}`, async () => {
    const backing = createMemoryFileSystem();
    const modes: (number | undefined)[] = [];
    const leaf = new Proxy(backing, { get(target, key) {
      if (key === "capabilities") {
        const capabilities: FileSystemCapabilities = Object.fromEntries(Object.entries(target.capabilities).filter(([name]) => name !== "permissions"));
        return { ...capabilities, open: canonical, ...(permissions === false ? { permissions } : {}) };
      }
      if (key === "open") return (path: string, options: OpenFileOptions) => { modes.push(options.mode); return target.open(path, options); };
      if (key === "writeStream") return (path: string, source: Parameters<typeof target.writeStream>[1], options: Parameters<typeof target.writeStream>[2]) => {
        modes.push(options?.mode);
        return target.writeStream(path, source, options);
      };
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": leaf } });
    const shell = new Shell({ fs });
    try {
      const result = await shell.exec("umask 077; set -C; : >/data/new");
      assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: 0, stdout: "", stderr: "" });
      assert.deepEqual(modes, [permissions === false ? canonical ? 0o666 : undefined : 0o600]);
      assert.equal((await backing.stat("/new")).mode & 0o777, permissions === false ? 0o666 : 0o600);
      assert.deepEqual(await backing.readFile("/new"), new Uint8Array());
      const missing = await shell.exec("set -C; : >/data/missing/new");
      assert.equal(missing.exitCode, 1);
      assert.equal(missing.stderr, "shell: line 1: /data/missing/new: No such file or directory\n");
    } finally { await shell.dispose(); }
  });
}

for (const reason of [null, false, 0, "", Number.NaN]) {
  test(`exclusive output cancellation drains acquired descriptor exactly once: ${String(reason)}`, async () => {
    const backing = createMemoryFileSystem();
    const controller = new AbortController();
    const cleanups: (() => void | Promise<void>)[] = [];
    const closes: ReturnType<typeof mock.fn>[] = [];
    const leaf = new Proxy(backing, { get(target, key) {
      if (key === "open") return async (path: string, options: OpenFileOptions) => {
        const descriptor = await target.open(path, options);
        const close = mock.method(descriptor, "close");
        closes.push(close);
        controller.abort(reason);
        return descriptor;
      };
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const context = { fs: createDeviceFileSystem(leaf), signal: controller.signal, registerCleanup: (cleanup: () => void | Promise<void>) => { cleanups.push(cleanup); } };
    bindFileOutputBudget(context, sink => sink, (_chunk, write) => write());
    try { await openFileOutput(context, "/new", { flag: "wx", descriptor: true }); assert.fail("expected acquisition cancellation"); }
    catch (error) { assert.equal(Object.is(error, reason), true); }
    const drained = await Promise.allSettled(cleanups.map(cleanup => cleanup()));
    for (const outcome of drained) if (outcome.status === "rejected") assert.equal(Object.is(outcome.reason, reason), true);
    assert.equal(closes.length, 1);
    const close = closes[0];
    assert.ok(close);
    assert.equal(close.mock.calls.length, 1);
    assert.deepEqual(await backing.readFile("/new"), new Uint8Array());
  });
}

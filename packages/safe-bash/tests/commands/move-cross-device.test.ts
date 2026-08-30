import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../src/fs/mount/index.js";
import { MoveBudget } from "../../src/commands/move.js";
import { run } from "./helpers.js";

function proxy(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const owner = key in methods ? methods : target, value = Reflect.get(owner, key);
    return typeof value === "function" ? value.bind(owner) : value;
  } });
}

async function pair(existing = false, shared = false) {
  const left = createMemoryFileSystem(), right = shared ? left : createMemoryFileSystem();
  await left.writeFile("/source", Buffer.from("payload"));
  if (existing) await right.writeFile("/target", Buffer.from("previous"));
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
  return { left, right, fs };
}

async function contents(fs: FileSystem, path: string): Promise<string> { return Buffer.from(await fs.readFile(path)).toString(); }

for (const shared of [false, true]) for (const existing of [false, true]) {
  test(`cross-mount file move succeeds: shared=${shared} existing=${existing}`, async () => {
    const { fs, left, right } = await pair(existing, shared);
    const result = await run("mv", ["-v", "/left/source", "/right/target"], { fs, cwd: "/" });
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(await contents(right, "/target"), "payload");
    await assert.rejects(left.lstat("/source"), { code: "ENOENT" });
    assert.match(result.stdout, /source.*target/u);
  });
}

test("cross-mount hardlink alias is a no-op, never copy followed by source removal", async () => {
  const { fs, left } = await pair(false, true); await left.link("/source", "/target");
  let copies = 0, removals = 0;
  const wrapped = proxy(fs, { copyFile: async () => { copies++; }, rm: async () => { removals++; } });
  const result = await run("mv", ["/left/source", "/right/target"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 1, result.stderr); assert.equal(copies, 0); assert.equal(removals, 0);
  assert.equal(await contents(left, "/source"), "payload"); assert.equal(await contents(left, "/target"), "payload");
});

test("unknown existing identity rejects before a hypothetical no-op copy or deletion", async () => {
  const { fs, left, right } = await pair(true); let copies = 0, removals = 0;
  const wrapped = proxy(fs, { lstat: async (path, options) => {
    const { identityScope: ignored, ...stat } = await fs.lstat(path, options); void ignored; return stat;
  }, copyFile: async () => { copies++; }, rm: async () => { removals++; } });
  const result = await run("mv", ["/left/source", "/right/target"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /authoritative distinctness/u);
  assert.equal(copies, 0); assert.equal(removals, 0); assert.equal(await contents(left, "/source"), "payload"); assert.equal(await contents(right, "/target"), "previous");
});

for (const noClobber of [false, true]) test(`raced missing destination uses actual exclusive creation, no-clobber=${noClobber}`, async () => {
  const { fs, left, right } = await pair(); let removals = 0;
  const wrapped = proxy(fs, { copyFile: async (source, target, options) => {
    assert.equal(options?.exclusive, true); await right.writeFile("/target", Buffer.from("concurrent")); await fs.copyFile(source, target, options);
  }, rm: async () => { removals++; } });
  const result = await run("mv", [...(noClobber ? ["-n"] : []), "/left/source", "/right/target"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, noClobber ? 0 : 1); assert.equal(removals, 0);
  assert.equal(await contents(left, "/source"), "payload"); assert.equal(await contents(right, "/target"), "concurrent");
});

for (const code of ["EIO", "EACCES", "ENOTSUP"] as const) test(`non-EXDEV rename ${code} never starts fallback`, async () => {
  const { fs, left } = await pair(); let copies = 0;
  const wrapped = proxy(fs, { rename: async () => { throw new FsError(code); }, copyFile: async () => { copies++; } });
  const result = await run("mv", ["/left/source", "/right/target"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 1); assert.equal(copies, 0); assert.equal(await contents(left, "/source"), "payload");
});

test("EXDEV-shaped caller abort does not trigger fallback or mutate source", async () => {
  const { fs, left } = await pair(), controller = new AbortController(), reason = new FsError("EXDEV"); let copies = 0;
  const wrapped = proxy(fs, { rename: async () => { controller.abort(reason); throw reason; }, copyFile: async () => { copies++; } });
  await assert.rejects(run("mv", ["/left/source", "/right/target"], { fs: wrapped, cwd: "/", signal: controller.signal }), error => error === reason);
  assert.equal(copies, 0); assert.equal(await contents(left, "/source"), "payload");
});

test("failed publication may leave partial destination but never removes source", async () => {
  const { fs, left, right } = await pair(); let removals = 0;
  const wrapped = proxy(fs, { copyFile: async (_source, _target, options) => {
    assert.ok(options?.signal);
    await right.writeFile("/target", Buffer.from("partial"), { signal: options.signal }); throw new FsError("EIO");
  }, rm: async () => { removals++; } });
  const result = await run("mv", ["/left/source", "/right/target"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 1); assert.equal(removals, 0); assert.equal(await contents(left, "/source"), "payload"); assert.equal(await contents(right, "/target"), "partial");
});

test("source replacement after copy is retained, with explicit partial-move failure", async () => {
  const { fs, left, right } = await pair(); let removals = 0;
  const wrapped = proxy(fs, { copyFile: async (source, target, options) => {
    await fs.copyFile(source, target, options); await left.rm("/source"); await left.writeFile("/source", Buffer.from("changed"));
  }, rm: async () => { removals++; } });
  const result = await run("mv", ["/left/source", "/right/target"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /source changed/u); assert.equal(removals, 0);
  assert.equal(await contents(left, "/source"), "changed"); assert.equal(await contents(right, "/target"), "payload");
});

test("one caller signal propagates through copy, metadata and removal", async () => {
  const { fs, left } = await pair(), controller = new AbortController();
  const seen: string[] = [];
  const wrapped = proxy(fs, {
    copyFile: async (source, target, options) => { assert.equal(options?.signal, controller.signal); seen.push("copy"); await fs.copyFile(source, target, options); },
    rm: async (path, options) => { assert.equal(options?.signal, controller.signal); assert.equal(options.recursive, false); seen.push("remove"); await fs.rm(path, options); },
  });
  const result = await run("mv", ["/left/source", "/right/target"], { fs: wrapped, cwd: "/", signal: controller.signal });
  assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(seen, ["copy", "remove"]); await assert.rejects(left.stat("/source"), { code: "ENOENT" });
});

test("cross-mount symlink moves the link, not its referent", async () => {
  const { fs, left, right } = await pair(); await left.symlink("source", "/link");
  const result = await run("mv", ["/left/link", "/right/link"], { fs, cwd: "/" });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(await right.readlink("/link"), "source");
  assert.equal(await contents(left, "/source"), "payload"); await assert.rejects(left.lstat("/link"), { code: "ENOENT" });
});

test("destination symlink is replaced instead of modifying its referent", async () => {
  const { fs, left, right } = await pair(); await right.writeFile("/keep", Buffer.from("sentinel")); await right.symlink("keep", "/target");
  const result = await run("mv", ["/left/source", "/right/target"], { fs, cwd: "/" });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(await contents(right, "/keep"), "sentinel");
  assert.equal((await right.lstat("/target")).type, "file"); await assert.rejects(left.lstat("/source"), { code: "ENOENT" });
});

async function directoryPair() {
  const left = createMemoryFileSystem(), right = createMemoryFileSystem();
  await left.mkdir("/tree/deep", { recursive: true }); await left.writeFile("/tree/first", Buffer.from("first")); await left.writeFile("/tree/deep/last", Buffer.from("last"));
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
  return { fs, left, right };
}

test("directory move publishes all copied children before any nonrecursive source cleanup", async () => {
  const { fs, left, right } = await directoryPair(); const sequence: string[] = [];
  const wrapped = proxy(fs, {
    copyFile: async (source, target, options) => { sequence.push("copy"); await fs.copyFile(source, target, options); },
    rm: async (path, options) => { sequence.push("remove"); assert.equal(options?.recursive, false); assert.equal(await contents(right, "/tree/first"), "first"); assert.equal(await contents(right, "/tree/deep/last"), "last"); await fs.rm(path, options); },
    rmdir: async (path, options) => { sequence.push("rmdir"); await fs.rmdir(path, options); },
  });
  const result = await run("mv", ["/left/tree", "/right/tree"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(sequence.slice(0, 2), ["copy", "copy"]); await assert.rejects(left.lstat("/tree"), { code: "ENOENT" });
});

test("copy failure in a directory leaves every original entry present", async () => {
  const { fs, left } = await directoryPair(); let calls = 0, removals = 0;
  const wrapped = proxy(fs, { copyFile: async (source, target, options) => { if (++calls === 2) throw new FsError("ENOSPC"); await fs.copyFile(source, target, options); }, rm: async () => { removals++; }, rmdir: async () => { removals++; } });
  const result = await run("mv", ["/left/tree", "/right/tree"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 1); assert.equal(removals, 0); assert.equal(await contents(left, "/tree/first"), "first"); assert.equal(await contents(left, "/tree/deep/last"), "last");
});

test("new source child during cleanup is never swept by recursive deletion", async () => {
  const { fs, left, right } = await directoryPair(); let inserted = false;
  const wrapped = proxy(fs, { rm: async (path, options) => {
    assert.equal(options?.recursive, false); await fs.rm(path, options);
    if (!inserted) { inserted = true; await left.writeFile("/tree/new-child", Buffer.from("must survive")); }
  } });
  const result = await run("mv", ["/left/tree", "/right/tree"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /ENOTEMPTY/u);
  assert.equal(await contents(left, "/tree/new-child"), "must survive"); assert.equal(await contents(right, "/tree/first"), "first"); assert.equal(await contents(right, "/tree/deep/last"), "last");
});

test("directory self-traversal through repeated mounts is rejected before writes", async () => {
  const { left } = await directoryPair(); const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": left } });
  const result = await run("mv", ["/left/tree", "/right/tree/inside"], { fs, cwd: "/" });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /into itself/u); await assert.rejects(left.stat("/tree/inside"), { code: "ENOENT" });
});

test("missing nonrecursive directory removal capability fails before copies", async () => {
  const { fs, right } = await directoryPair();
  const wrapped = new Proxy(fs, { get(target, key) { const value = Reflect.get(target, key); return key === "rmdir" ? undefined : typeof value === "function" ? value.bind(target) : value; } });
  const result = await run("mv", ["/left/tree", "/right/tree"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /ENOTSUP/u); assert.deepEqual(await right.readdir("/"), []);
});

test("explicit unsupported timestamp preservation warns without making ordinary moves unusable", async () => {
  const { fs, left, right } = await pair();
  const wrapped = proxy(fs, { utimes: async () => { throw new FsError("ENOTSUP"); } });
  const result = await run("mv", ["/left/source", "/right/target"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 0); assert.match(result.stderr, /cannot preserve timestamps/u);
  assert.equal(await contents(right, "/target"), "payload"); await assert.rejects(left.stat("/source"), { code: "ENOENT" });
});

for (const aborted of [false, true]) test(`timestamp errors are not broadly swallowed: aborted=${aborted}`, async () => {
  const { fs, left } = await pair(), controller = new AbortController();
  const reason = new FsError(aborted ? "ENOTSUP" : "EIO"); let removals = 0;
  const wrapped = proxy(fs, { utimes: async () => { if (aborted) controller.abort(reason); throw reason; }, rm: async () => { removals++; } });
  const running = run("mv", ["/left/source", "/right/target"], { fs: wrapped, cwd: "/", signal: controller.signal });
  if (aborted) await assert.rejects(running, error => error === reason);
  else assert.equal((await running).exitCode, 1);
  assert.equal(removals, 0); assert.equal(await contents(left, "/source"), "payload");
});

test("identity downgrade after publication does not authorize source deletion", async () => {
  const { fs, left } = await pair(); let copied = false, removals = 0;
  const wrapped = proxy(fs, { copyFile: async (source, target, options) => { await fs.copyFile(source, target, options); copied = true; },
    lstat: async (path, options) => {
      const stat = await fs.lstat(path, options);
      if (!copied || path !== "/left/source") return stat;
      const { identityScope: ignored, ...withoutIdentity } = stat; void ignored; return withoutIdentity;
    }, rm: async () => { removals++; },
  });
  const result = await run("mv", ["/left/source", "/right/target"], { fs: wrapped, cwd: "/" });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /source changed/u); assert.equal(removals, 0);
  assert.equal(await contents(left, "/source"), "payload");
});

test("move planning budget is cumulative and preserves its caller signal", async () => {
  const controller = new AbortController(), budget = new MoveBudget(controller.signal);
  for (let index = 0; index < 100_000; index++) await budget.step();
  assert.equal(budget.remaining, 0); await assert.rejects(budget.step(), { code: "EFBIG" });
  const reason = new Error("stop exhausted move"); controller.abort(reason);
  await assert.rejects(budget.step(), error => error === reason);
});

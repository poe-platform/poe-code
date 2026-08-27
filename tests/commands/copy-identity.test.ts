import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileStat, type FileSystem } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../src/fs/mount/index.js";
import { compareCopyIdentity } from "../../src/commands/copy-identity.js";
import { fixture, run } from "./helpers.js";

function proxy(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const owner = key in methods ? methods : target, value = Reflect.get(owner, key);
    return typeof value === "function" ? value.bind(owner) : value;
  } });
}

test("cp permits colliding inode coordinates from truthful independent scopes", async () => {
  const left = createMemoryFileSystem(), right = createMemoryFileSystem();
  await left.writeFile("/source", Buffer.from("copied")); await right.writeFile("/target", Buffer.from("old"));
  const source = await left.stat("/source"), target = await right.stat("/target");
  assert.equal(source.ino, target.ino); assert.equal(source.dev, target.dev); assert.notEqual(source.identityScope, target.identityScope);
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
  const result = await run("cp", ["/left/source", "/right/target"], { fs, cwd: "/" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await right.readFile("/target")).toString(), "copied");
  assert.equal(Buffer.from(await left.readFile("/source")).toString(), "copied");
});

test("cp retains same-scope alias rejection before backend copy", async () => {
  const base = await fixture({ source: "sentinel" }); await base.link("/work/source", "/work/alias");
  let copies = 0;
  const fs = proxy(base, { copyFile: async () => { copies++; throw new Error("must not copy"); } });
  const result = await run("cp", ["source", "alias"], { fs });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /same file/u); assert.equal(copies, 0);
  assert.equal(Buffer.from(await base.readFile("/work/source")).toString(), "sentinel");
});

test("cp does not manufacture equality from unscoped or invalid tuples", async () => {
  for (const identityScope of [undefined, null, "untrusted-scope"]) {
    const base = await fixture({ source: "new", target: "old" }); let copies = 0;
    const spoof = async (path: string): Promise<FileStat> => ({ ...await base.stat(path), identityScope, dev: 1, ino: 1 }) as unknown as FileStat;
    const fs = proxy(base, { stat: spoof, copyFile: async (source, target, options) => { copies++; await base.copyFile(source, target, options); } });
    const result = await run("cp", ["source", "target"], { fs });
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(copies, 1);
    assert.equal(Buffer.from(await base.readFile("/work/target")).toString(), "new");
  }
});

test("scope comparisons are opaque equality and require complete safe coordinates", () => {
  const scope = {}, stat: FileStat = { type: "file", size: 1, mode: 0o600, mtimeMs: 0, atimeMs: 0, ctimeMs: 0, identityScope: scope, dev: 1, ino: 2 };
  assert.equal(compareCopyIdentity(stat, { ...stat }), "same");
  assert.equal(compareCopyIdentity(stat, { ...stat, identityScope: {} }), "distinct");
  assert.equal(compareCopyIdentity(stat, { ...stat, ino: 3 }), "distinct");
  for (const coordinate of [undefined, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(compareCopyIdentity(stat, { ...stat, ino: coordinate } as FileStat), "unknown");
    assert.equal(compareCopyIdentity(stat, { ...stat, dev: coordinate } as FileStat), "unknown");
  }
  assert.equal(compareCopyIdentity(stat, undefined), "unknown");
});

test("cp -f does not unlink destination after an EACCES-shaped caller abort", async () => {
  const base = await fixture({ source: "source", target: "keep" }), controller = new AbortController();
  const reason = new FsError("EACCES", { message: "caller stopped" }); let removes = 0;
  const fs = proxy(base, { copyFile: async () => { controller.abort(reason); throw reason; }, rm: async () => { removes++; } });
  await assert.rejects(run("cp", ["-f", "source", "target"], { fs, signal: controller.signal }), error => error === reason);
  assert.equal(removes, 0); assert.equal(Buffer.from(await base.readFile("/work/target")).toString(), "keep");
});

test("ENOENT-shaped stat abort is not reinterpreted as a missing path", async () => {
  const base = await fixture({ source: "source", target: "keep" }), controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "caller stopped" }); let mutations = 0;
  const fs = proxy(base, { stat: async () => { controller.abort(reason); throw reason; }, copyFile: async () => { mutations++; } });
  await assert.rejects(run("cp", ["source", "target"], { fs, signal: controller.signal }), error => error === reason);
  assert.equal(mutations, 0);
});

test("cp -f refuses unproven unlink authority after EACCES", async () => {
  const base = await fixture({ source: "source", target: "keep" }); let removals = 0;
  const withoutScope = async (path: string): Promise<FileStat> => { const { identityScope: ignored, ...stat } = await base.lstat(path); void ignored; return stat; };
  const fs = proxy(base, { stat: withoutScope, lstat: withoutScope, copyFile: async () => { throw new FsError("EACCES"); }, rm: async () => { removals++; } });
  const result = await run("cp", ["-f", "source", "target"], { fs });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /authoritative distinctness/u); assert.equal(removals, 0);
  assert.equal(Buffer.from(await base.readFile("/work/source")).toString(), "source"); assert.equal(Buffer.from(await base.readFile("/work/target")).toString(), "keep");
});

test("cp -f rechecks a destination replaced by a source hardlink before unlink", async () => {
  const base = await fixture({ source: "source", target: "keep" }); let removals = 0;
  const fs = proxy(base, { copyFile: async () => { await base.rm("/work/target"); await base.link("/work/source", "/work/target"); throw new FsError("EACCES"); }, rm: async () => { removals++; } });
  const result = await run("cp", ["-f", "source", "target"], { fs });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /same file/u); assert.equal(removals, 0);
  assert.equal(Buffer.from(await base.readFile("/work/source")).toString(), "source"); assert.equal(Buffer.from(await base.readFile("/work/target")).toString(), "source");
});

test("cp -f retains legitimate unlink retry, but uses exclusive replacement creation", async () => {
  const base = await fixture({ source: "source", target: "keep" }); let copies = 0;
  const fs = proxy(base, { copyFile: async (source, target, options) => { if (++copies === 1) throw new FsError("EACCES"); assert.equal(options?.exclusive, true); await base.copyFile(source, target, options); } });
  const result = await run("cp", ["-f", "source", "target"], { fs });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(copies, 2);
  assert.equal(Buffer.from(await base.readFile("/work/source")).toString(), "source"); assert.equal(Buffer.from(await base.readFile("/work/target")).toString(), "source");
});

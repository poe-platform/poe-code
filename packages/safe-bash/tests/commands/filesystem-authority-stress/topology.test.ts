import assert from "node:assert/strict";
import test from "node:test";
import { type EntryComparison, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { bytes, command, payload, previous, unscoped, view } from "./helpers.js";

function peers(scopedSource = false) {
  const providers = new WeakMap<FileSystem, FileSystem>();
  const queries: string[] = [];
  function client(base: FileSystem, label: string, answer?: EntryComparison, scoped = false): FileSystem {
    const fs = view(base, {
      stat: async (path, controls) => { const stat = await base.stat(path, controls); return scoped || scopedSource && path === "/source" ? stat : unscoped(stat); },
      lstat: async (path, controls) => { const stat = await base.lstat(path, controls); return scoped || scopedSource && path === "/source" ? stat : unscoped(stat); },
      compareEntry: async (path, peer, peerPath, controls) => {
        controls?.signal?.throwIfAborted();
        queries.push(label);
        const other = providers.get(peer);
        if (!other) return "unknown";
        if (answer) return answer;
        const left = await base.stat(path, controls);
        controls?.signal?.throwIfAborted();
        const right = await other.stat(peerPath, controls);
        return left.identityScope === right.identityScope && left.dev === right.dev && left.ino === right.ino ? "same" : "distinct";
      },
    });
    providers.set(fs, base);
    return fs;
  }
  return { client, queries };
}

for (const name of ["cp", "mv"] as const) for (const shared of [false, true]) for (const existing of [false, true]) {
  test(`${name}: cross-mount distinct entries transfer safely, same backend=${shared}, overwrite=${existing}`, async () => {
    const left = createMemoryFileSystem(), right = shared ? left : createMemoryFileSystem();
    await left.writeFile("/source", payload);
    if (existing) await right.writeFile("/target", previous);
    const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
    const result = await command(name, ["/left/source", "/right/target"], fs);
    assert.equal(result.stdout, "");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(await bytes(right, "/target"), payload);
    assert.deepEqual(await bytes(left, "/source"), name === "mv" ? null : payload);
    assert.deepEqual((await left.readdir("/")).map(entry => entry.name), shared ? name === "mv" ? ["target"] : ["source", "target"] : name === "mv" ? [] : ["source"]);
    assert.deepEqual((await right.readdir("/")).map(entry => entry.name), shared && name === "cp" ? ["source", "target"] : ["target"]);
  });
}

for (const name of ["cp", "mv"] as const) for (const alias of [false, true]) for (const scopedSource of [false, true]) {
  test(`${name}: recognized clients preserve transfer admission, alias=${alias}, scoped source=${scopedSource}`, async () => {
    const base = createMemoryFileSystem();
    await base.writeFile("/source", payload);
    if (alias) await base.link("/source", "/target");
    else await base.writeFile("/target", previous);
    const { client, queries } = peers(scopedSource);
    const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": client(base, "left"), "/right": client(base, "right") } });
    const before = await base.readdir("/");
    const result = await command(name, ["/left/source", "/right/target"], fs);
    const allowed = name === "cp" && scopedSource && !alias;
    assert.equal(result.exitCode, allowed ? 0 : 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, allowed ? "" : alias
      ? `${name}: EINVAL: source and destination are the same file '/left/source' -> '/right/target'\n`
      : name === "cp" ? "cp: ENOTSUP: copy reader is not bound to the inspected source identity '/left/source'\n"
      : scopedSource ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/right/target'\n"
        : "mv: ENOTSUP: move source lacks authoritative snapshot '/left/source'\n");
    assert.deepEqual(queries, ["left", "right"], "transfer admission uses the first authoritative comparison");
    assert.deepEqual(await bytes(base, "/target"), allowed || alias ? payload : previous);
    assert.deepEqual(await bytes(base, "/source"), payload);
    assert.deepEqual(await base.readdir("/"), before);
  });
}

for (const [name, existing] of [["cp", false], ["cp", true], ["mv", false]] as const) {
  test(`${name}: clients preserving complete backing identity transfer successfully, overwrite=${existing}`, async () => {
    const base = createMemoryFileSystem();
    await base.writeFile("/source", payload);
    if (existing) await base.writeFile("/target", previous);
    const { client, queries } = peers();
    const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: {
      "/left": client(base, "left", undefined, true), "/right": client(base, "right", undefined, true),
    } });
    const result = await command(name, ["/left/source", "/right/target"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(queries, [], "complete scoped identity does not require fallback authority queries");
    assert.deepEqual(await bytes(base, "/target"), payload);
    assert.deepEqual(await bytes(base, "/source"), name === "mv" ? null : payload);
    assert.deepEqual((await base.readdir("/")).map(entry => entry.name), name === "mv" ? ["target"] : ["source", "target"]);
  });
}

for (const name of ["cp", "mv"] as const) test(`${name}: conflicting recognized authorities fail before content effects`, async () => {
  const left = createMemoryFileSystem(), right = createMemoryFileSystem();
  await left.writeFile("/source", payload);
  await right.writeFile("/target", previous);
  const { client, queries } = peers();
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: {
    "/left": client(left, "left", "distinct"), "/right": client(right, "right", "same"),
  } });
  const result = await command(name, ["/left/source", "/right/target"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EIO.*compareEntry/u);
  assert.deepEqual(queries, ["left", "right"]);
  assert.deepEqual(await bytes(left, "/source"), payload);
  assert.deepEqual(await bytes(right, "/target"), previous);
});

test("complete scopes: equal device/inode numbers in independent stores do not mean alias", async () => {
  const left = createMemoryFileSystem(), right = createMemoryFileSystem();
  await left.writeFile("/same", payload);
  await right.writeFile("/same", previous);
  const leftStat = await left.stat("/same"), rightStat = await right.stat("/same");
  assert.equal(leftStat.dev, rightStat.dev);
  assert.equal(leftStat.ino, rightStat.ino);
  assert.notEqual(leftStat.identityScope, rightStat.identityScope);
  const guarded = (base: FileSystem) => view(base, { compareEntry: async () => { throw new Error("complete tuples must not query"); } });
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": guarded(left), "/right": guarded(right) } });
  const result = await command("cp", ["/left/same", "/right/same"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await bytes(left, "/same"), payload);
  assert.deepEqual(await bytes(right, "/same"), payload);
});

for (const name of ["cp", "mv"] as const) for (const sourceReadonly of [false, true]) {
  test(`${name}: readonly ${sourceReadonly ? "source" : "destination"} preserves policy through mounts`, async () => {
    const left = createMemoryFileSystem(), right = createMemoryFileSystem();
    await left.writeFile("/source", payload);
    await right.writeFile("/target", previous);
    const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: {
      "/left": sourceReadonly ? createReadOnlyFileSystem(left) : left,
      "/right": sourceReadonly ? right : createReadOnlyFileSystem(right),
    } });
    const result = await command(name, ["/left/source", "/right/target"], fs);
    const allowed = name === "cp" && sourceReadonly;
    assert.equal(result.exitCode, allowed ? 0 : 1, result.stderr);
    if (!allowed) assert.match(result.stderr, /EROFS/u);
    assert.deepEqual(await bytes(left, "/source"), payload);
    assert.deepEqual(await bytes(right, "/target"), allowed ? payload : previous);
  });
}

test("copy through a source symlink observes followed hardlink identity", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/data", payload);
  await base.link("/data", "/hard");
  await base.symlink("data", "/soft");
  const { client } = peers();
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": client(base, "left"), "/right": client(base, "right") } });
  const result = await command("cp", ["/left/soft", "/right/hard"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /same file/u);
  assert.equal(await base.readlink("/soft"), "data");
  assert.deepEqual(await bytes(base, "/data"), payload);
  assert.deepEqual(await bytes(base, "/hard"), payload);
});

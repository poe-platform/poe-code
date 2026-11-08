import assert from "node:assert/strict";
import { test } from "vitest";
import type { FileStat, FileSystem } from "../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { FileSystemQuotaError, withFileSystemQuota } from "../src/fs/quota/index.js";

const bytes = (length: number): Uint8Array => new Uint8Array(length).fill(120);

test("quota counts growth through every hard-linked namespace entry", async () => {
  const raw = createMemoryFileSystem();
  const quota = withFileSystemQuota(raw, { maxBytes: 128 });
  await quota.writeFile("/a", bytes(1));
  await quota.link!("/a", "/b");
  await assert.rejects(quota.writeFile("/a", bytes(100)), FileSystemQuotaError);
  assert.equal((await raw.stat("/a")).size, 1);
  assert.equal((await raw.stat("/b")).size, 1);
  await quota.writeFile("/b", bytes(64));
  assert.equal((await raw.stat("/a")).size, 64);
  await assert.rejects(quota.appendFile("/a", bytes(1)), FileSystemQuotaError);
});

for (const operation of ["write", "append", "append-flag", "truncate", "copy", "stream", "stream-append"] as const) {
  test(`quota admits all alias growth before ${operation}`, async () => {
    const raw = createMemoryFileSystem();
    const quota = withFileSystemQuota(raw, { maxBytes: 10 });
    await quota.writeFile("/a", bytes(2));
    await quota.writeFile("/source", bytes(4));
    await quota.link!("/a", "/b");
    const mutate = async () => {
      switch (operation) {
        case "write": return quota.writeFile("/a", bytes(4));
        case "append": return quota.appendFile("/b", bytes(2));
        case "append-flag": return quota.writeFile("/a", bytes(2), { flag: "a" });
        case "truncate": return quota.truncate!("/b", 4);
        case "copy": return quota.copyFile("/source", "/a");
        case "stream": return quota.writeStream!("/a", (async function* () { yield bytes(2); yield bytes(2); })());
        case "stream-append": return quota.writeStream!("/b", (async function* () { yield bytes(2); })(), { flag: "a" });
      }
    };
    await assert.rejects(mutate(), FileSystemQuotaError);
    assert.equal((await raw.stat("/a")).size, 2);
    assert.equal((await raw.stat("/b")).size, 2);
    await quota.writeFile("/b", bytes(3));
    assert.equal((await raw.stat("/a")).size, 3);
    await quota.truncate!("/a", 1);
    assert.equal((await raw.stat("/b")).size, 1);
  });
}

test("quota follows the write referent without charging symlink entries as file aliases", async () => {
  const raw = createMemoryFileSystem();
  const quota = withFileSystemQuota(raw, { maxBytes: 10 });
  await quota.mkdir("/nested");
  await quota.writeFile("/a", bytes(1));
  await quota.link!("/a", "/b");
  await quota.link!("/a", "/nested/c");
  await quota.symlink!("/a", "/pointer");
  await assert.rejects(quota.writeFile("/pointer", bytes(3)), FileSystemQuotaError);
  await quota.writeFile("/pointer", bytes(2));
  for (const path of ["/a", "/b", "/nested/c"]) assert.equal((await raw.stat(path)).size, 2);
  assert.equal((await raw.lstat("/pointer")).size, 2);
});

function metadataView(raw: FileSystem, transform: (stat: FileStat, path: string) => FileStat, comparison = false): FileSystem {
  return new Proxy(raw, {
    get(target, property) {
      if (property === "stat" || property === "lstat") return async (path: string, options?: Parameters<FileSystem["stat"]>[1]) => transform(await target[property](path, options), path);
      if (property === "compareEntry") return comparison
        ? async (path: string, _peer: FileSystem, peerPath: string, options?: Parameters<FileSystem["stat"]>[1]) => raw.compareEntry!(path, raw, peerPath, options)
        : undefined;
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function withoutIdentity(stat: FileStat): FileStat {
  const result = { ...stat };
  delete result.identityScope;
  delete result.ino;
  delete result.dev;
  delete result.nlink;
  return result;
}

test("quota does not rely on absent identity or link counts to assume a single alias", async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/a", bytes(1));
  await raw.link!("/a", "/b");
  const quota = withFileSystemQuota(metadataView(raw, withoutIdentity), { maxBytes: 4 });
  await assert.rejects(quota.writeFile("/a", bytes(3)), FileSystemQuotaError);
  await quota.writeFile("/b", bytes(2));
  assert.equal((await raw.stat("/a")).size, 2);
});

test("quota treats incomplete identity tuples as potentially aliased", async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/a", bytes(1));
  await raw.link!("/a", "/b");
  const scopes = { "/a": Symbol(), "/b": Symbol() };
  const view = metadataView(raw, (stat, path) => {
    const result = { ...stat, identityScope: scopes[path as keyof typeof scopes] ?? Symbol(), nlink: 1 };
    delete result.ino;
    return result;
  });
  const quota = withFileSystemQuota(view, { maxBytes: 4 });
  await assert.rejects(quota.writeFile("/a", bytes(3)), FileSystemQuotaError);
  assert.equal((await raw.stat("/b")).size, 1);
});

test("quota counts repeated namespace views independently of physical link count", async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/a", bytes(1));
  const mounted = new MountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": raw, "/right": raw } });
  const quota = withFileSystemQuota(mounted, { maxBytes: 4 });
  assert.equal((await mounted.stat("/left/a")).nlink, 1);
  await assert.rejects(quota.writeFile("/left/a", bytes(3)), FileSystemQuotaError);
  await quota.writeFile("/left/a", bytes(2));
  assert.equal((await mounted.stat("/right/a")).size, 2);
});

test("quota recognizes complete identities in independent backing scopes as distinct", async () => {
  const left = createMemoryFileSystem();
  const right = createMemoryFileSystem();
  await left.writeFile("/a", bytes(1));
  await right.writeFile("/a", bytes(1));
  const mounted = new MountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
  const quota = withFileSystemQuota(metadataView(mounted, stat => stat), { maxBytes: 3 });
  await quota.writeFile("/left/a", bytes(2));
  assert.equal((await right.stat("/a")).size, 1);
});

test("quota does not credit every read alias when one overlay write copies up", async () => {
  const lower = createMemoryFileSystem();
  await lower.writeFile("/a", bytes(40));
  const left = new OverlayFileSystem({ upper: createMemoryFileSystem(), lower });
  const right = new OverlayFileSystem({ upper: createMemoryFileSystem(), lower });
  const mounted = new MountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
  const quota = withFileSystemQuota(mounted, { maxBytes: 30 });
  await assert.rejects(quota.writeFile("/left/a", bytes(10)), FileSystemQuotaError);
  assert.equal((await left.stat("/a")).size, 40);
  assert.equal((await right.stat("/a")).size, 40);
});

for (const comparison of ["invalid", null, undefined]) test(`quota rejects invalid comparison result ${String(comparison)} before mutation`, async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/a", bytes(1));
  const view = new Proxy(metadataView(raw, withoutIdentity), {
    get(target, property) {
      if (property === "compareEntry") return async () => comparison;
      return Reflect.get(target, property);
    },
  });
  const quota = withFileSystemQuota(view, { maxBytes: 8 });
  await assert.rejects(quota.writeFile("/a", bytes(2)), { code: "EIO" });
  assert.equal((await raw.stat("/a")).size, 1);
});

for (const reason of [false, null, 0, ""]) {
  test(`quota preserves cancellation during alias comparison: ${JSON.stringify(reason)}`, async () => {
    const raw = createMemoryFileSystem();
    await raw.writeFile("/a", bytes(1));
    const controller = new AbortController();
    const view = new Proxy(metadataView(raw, withoutIdentity), {
      get(target, property) {
        if (property === "compareEntry") return async () => { controller.abort(reason); return "same"; };
        return Reflect.get(target, property);
      },
    });
    const quota = withFileSystemQuota(view, { maxBytes: 8 });
    await assert.rejects(quota.writeFile("/a", bytes(2), { signal: controller.signal }), error => Object.is(error, reason));
    assert.equal((await raw.stat("/a")).size, 1);
  });
}

test("quota uses an explicit comparison binding when stat identities are unavailable", async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/a", bytes(1));
  await raw.writeFile("/distinct", bytes(1));
  const quota = withFileSystemQuota(metadataView(raw, withoutIdentity, true), { maxBytes: 3 });
  await quota.writeFile("/a", bytes(2));
  assert.equal((await raw.stat("/distinct")).size, 1);
  await raw.link!("/a", "/alias");
  await assert.rejects(quota.appendFile("/a", bytes(1)), FileSystemQuotaError);
});

test("quota conservatively reserves possible alias growth without a comparison binding", async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/a", bytes(1));
  await raw.writeFile("/distinct", bytes(1));
  const quota = withFileSystemQuota(metadataView(raw, withoutIdentity), { maxBytes: 3 });
  await assert.rejects(quota.writeFile("/a", bytes(2)), FileSystemQuotaError);
  assert.equal((await raw.stat("/a")).size, 1);
});

test("quota serializes competing growth through two names of the same file", async () => {
  const raw = createMemoryFileSystem();
  const quota = withFileSystemQuota(raw, { maxBytes: 6 });
  await quota.writeFile("/a", bytes(1));
  await quota.link!("/a", "/b");
  const results = await Promise.allSettled([quota.appendFile("/a", bytes(2)), quota.appendFile("/b", bytes(1))]);
  assert.equal(results[0]!.status, "fulfilled");
  assert.equal(results[1]!.status, "rejected");
  assert.equal((await raw.stat("/a")).size, 3);
  assert.equal((await raw.stat("/b")).size, 3);
});

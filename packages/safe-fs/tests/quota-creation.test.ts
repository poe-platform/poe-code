import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { FileSystemQuotaError, withFileSystemQuota } from "../src/fs/quota/index.js";

for (const operation of ["write", "append", "copy", "link", "symlink", "stream"] as const) {
  test(`quota counts empty mount aliases before initial ${operation}`, async () => {
    const backend = createMemoryFileSystem();
    const root = createMemoryFileSystem();
    await root.writeFile("/source", new Uint8Array(5));
    const mounted = new MountFileSystem({ root, mounts: { "/a": backend, "/b": backend } });
    if (operation === "link") await backend.writeFile("/source", new Uint8Array(5));
    const quota = withFileSystemQuota(mounted, { maxBytes: operation === "link" ? 23 : 13 });
    const data = new Uint8Array(5);
    await assert.rejects(async () => {
      switch (operation) {
        case "write": return quota.writeFile("/a/file", data);
        case "append": return quota.appendFile("/a/file", data);
        case "copy": return quota.copyFile("/source", "/a/file");
        case "link": return quota.link!("/a/source", "/a/file");
        case "symlink": return quota.symlink!("12345", "/a/file");
        case "stream": return quota.writeStream!("/a/file", (async function* () { yield data; })());
      }
    }, FileSystemQuotaError);
    assert.equal((await backend.readdir("/")).length, operation === "stream" || operation === "link" ? 1 : 0);
    if (operation === "stream") assert.equal((await backend.stat("/file")).size, 0);
  });
}

for (const operation of ["write", "truncate"] as const) {
  test(`quota meters initial retained descriptor ${operation} across mounts`, async () => {
    const backend = createMemoryFileSystem();
    const mounted = new MountFileSystem({ root: createMemoryFileSystem(), mounts: { "/a": backend, "/b": backend } });
    const quota = withFileSystemQuota(mounted, { maxBytes: 8 });
    const descriptor = await quota.open!("/a/file", { access: "readwrite", creation: "exclusive" });
    try {
      await assert.rejects(operation === "write" ? descriptor.write(new Uint8Array(5), 0) : descriptor.truncate(5), FileSystemQuotaError);
      assert.equal((await backend.stat("/file")).size, 0);
      await descriptor.write(new Uint8Array(4), 0);
      assert.equal((await mounted.stat("/b/file")).size, 4);
    } finally { await descriptor.close(); }
  });
}

test("quota reserves every alias of a private conditional descriptor", async () => {
  const backend = createMemoryFileSystem();
  backend.open = async (_path, options) => {
    const privateFs = createMemoryFileSystem();
    const descriptor = await privateFs.open!("/file", options);
    const publish = async () => backend.writeFile("/file", await privateFs.readFile("/file"));
    return new Proxy(Object.create(descriptor) as typeof descriptor, {
      get(_target, property) {
        if (property === "capabilities") return { ...descriptor.capabilities, publication: "conditional" };
        if (property === "close") return async () => { await publish(); await descriptor.close(); };
        if (property === "sync") return publish;
        const value: unknown = Reflect.get(descriptor, property);
        return typeof value === "function" ? value.bind(descriptor) : value;
      },
    });
  };
  const mounted = new MountFileSystem({ root: createMemoryFileSystem(), mounts: { "/a": backend, "/b": backend } });
  const quota = withFileSystemQuota(mounted, { maxBytes: 8 });
  const descriptor = await quota.open!("/a/file", { access: "readwrite", creation: "exclusive" });
  try {
    await assert.rejects(descriptor.write(new Uint8Array(5), 0), FileSystemQuotaError);
    await descriptor.write(new Uint8Array(4), 0);
    await assert.rejects(quota.writeFile("/other", new Uint8Array(1)), FileSystemQuotaError);
    await descriptor.sync(false);
    assert.equal((await mounted.stat("/b/file")).size, 4);
    await assert.rejects(descriptor.truncate(5), FileSystemQuotaError);
  } finally { await descriptor.close(); }
  await assert.rejects(quota.appendFile("/a/file", new Uint8Array(1)), FileSystemQuotaError);
});

test("initial creation counts nested aliases and accepts the exact byte boundary", async () => {
  const backend = createMemoryFileSystem();
  await backend.mkdir("/nested");
  const mounted = new MountFileSystem({ root: createMemoryFileSystem(), mounts: { "/a": backend, "/b": backend } });
  const quota = withFileSystemQuota(mounted, { maxBytes: 8 });
  await assert.rejects(quota.writeFile("/a/nested/file", new Uint8Array(5)), FileSystemQuotaError);
  await assert.rejects(backend.stat("/nested/file"), { code: "ENOENT" });
  await quota.writeFile("/a/nested/file", new Uint8Array(4));
  assert.equal((await quota.stat("/b/nested/file")).size, 4);
});

test("initial creation conservatively counts directories without identity evidence", async () => {
  const backend = createMemoryFileSystem();
  const mounted = new MountFileSystem({ root: createMemoryFileSystem(), mounts: { "/a": backend, "/b": backend } });
  const stat = mounted.stat.bind(mounted);
  mounted.stat = async (path, options) => {
    const metadata = { ...await stat(path, options) };
    delete metadata.identityScope;
    delete metadata.dev;
    delete metadata.ino;
    return metadata;
  };
  Object.defineProperty(mounted, "compareEntry", { value: undefined });
  const quota = withFileSystemQuota(mounted, { maxBytes: 8 });
  await assert.rejects(quota.writeFile("/a/file", new Uint8Array(5)), FileSystemQuotaError);
  assert.equal((await backend.readdir("/")).length, 0);
});

import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import type { FileSystem, PublishStagedFileOptions } from "../src/contracts/index.js";

for (const kind of ["memory", "mount", "device", "scope"] as const) test(`staged identity publication preserves hardlinks through ${kind}`, async () => {
  const memory = createMemoryFileSystem();
  let fs: FileSystem = memory;
  if (kind === "mount") fs = createMountFileSystem({ root: memory });
  if (kind === "device") fs = createDeviceFileSystem(memory);
  if (kind === "scope") fs = scopeFileSystem(memory, () => {}, new AbortController().signal);
  await fs.writeFile("/archive", Uint8Array.of(1));
  await fs.link!("/archive", "/alias");
  const destination = await fs.stat("/archive");
  const stage = await fs.createStagedFile!("/.stage", "file", { type: "file", data: new Uint8Array() }, { parent: await fs.stat("/"), retainCleanup: true, atimeMs: 1000, mtimeMs: 2000 });
  const payload = new Uint8Array(150003).fill(42);
  for (let offset = 0; offset < payload.length; offset += 4096) await stage.writer!.write(payload.subarray(offset, offset + 4096));
  const finished = { ...stage, file: { ...stage.file, stat: await stage.writer!.finish() } };
  const retained = await fs.openReadFile!(stage.file.path);
  const options: PublishStagedFileOptions = { parent: await fs.stat("/"), destination, preserveIdentity: true };
  await fs.publishStagedFile!(finished, "/archive", options);
  assert.equal((await fs.stat("/archive")).ino, destination.ino);
  assert.equal((await fs.stat("/alias")).nlink, 2);
  assert.deepEqual(await fs.readFile("/alias"), payload);
  assert.equal((await fs.stat("/archive")).mtimeMs, 2000);
  await stage.cleanup!.remove();
  assert.deepEqual(await retained.read(0, 16), payload.subarray(0, 16));
  await fs.writeFile("/alias", Uint8Array.of(7));
  assert.deepEqual(await retained.read(0, 16), payload.subarray(0, 16));
  await retained.close();
  assert.deepEqual((await memory.readdir("/")).map(entry => entry.name).sort(), ["alias", "archive"]);
});

for (const failure of ["stale", "guard", "abort"] as const) test(`staged identity publication rejects ${failure} before changing target`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/archive", Uint8Array.of(1));
  await fs.link!("/archive", "/alias");
  const destination = await fs.stat("/archive");
  const stage = await fs.createStagedFile!("/.stage", "file", { type: "file", data: Uint8Array.of(2) }, { parent: await fs.stat("/"), retainCleanup: true });
  const signal = new AbortController();
  if (failure === "stale") await fs.writeFile("/alias", Uint8Array.of(3));
  if (failure === "abort") signal.abort(new Error("stop"));
  const options: PublishStagedFileOptions = { parent: await fs.stat("/"), destination, preserveIdentity: true, signal: signal.signal,
    ...(failure === "guard" ? { commitGuard: () => { throw new Error("guard"); } } : {}) };
  await assert.rejects(fs.publishStagedFile!(stage, "/archive", options));
  assert.deepEqual(await fs.readFile("/archive"), Uint8Array.of(failure === "stale" ? 3 : 1));
  assert.deepEqual(await fs.readFile(stage.file.path), Uint8Array.of(2));
  await stage.cleanup!.remove();
});

for (const kind of ["mount", "device", "scope"] as const) test(`staged identity publication refuses unsupported ${kind} backends`, async () => {
  const memory = createMemoryFileSystem();
  const backend = new Proxy(memory, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, atomicStagedFileMutation: false };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fs = kind === "mount" ? createMountFileSystem({ root: backend }) : kind === "device" ? createDeviceFileSystem(backend) : scopeFileSystem(backend, () => {}, new AbortController().signal);
  await fs.writeFile("/archive", Uint8Array.of(1));
  const stage = await fs.createStagedFile!("/.stage", "file", { type: "file", data: Uint8Array.of(2) }, { parent: await fs.stat("/"), retainCleanup: true });
  await assert.rejects(fs.publishStagedFile!(stage, "/archive", { parent: await fs.stat("/"), destination: await fs.stat("/archive"), preserveIdentity: true }), { code: "ENOTSUP" });
  assert.deepEqual(await fs.readFile("/archive"), Uint8Array.of(1));
  await stage.cleanup!.remove();
});

test("staged identity publication storage admission preserves target and staging on failure", async () => {
  const fs = createMemoryFileSystem({ maxRetainedBytes: 20000, maxFileBytes: 15000 });
  await fs.writeFile("/archive", new Uint8Array(1000).fill(1));
  const stage = await fs.createStagedFile!("/.stage", "file", { type: "file", data: new Uint8Array(12000).fill(2) }, { parent: await fs.stat("/"), retainCleanup: true });
  const before = await fs.stat("/archive");
  await assert.rejects(fs.publishStagedFile!(stage, "/archive", { parent: await fs.stat("/"), destination: before, preserveIdentity: true }), { code: "ENOSPC" });
  assert.equal((await fs.stat("/archive")).revision, before.revision);
  assert.deepEqual(await fs.readFile("/archive"), new Uint8Array(1000).fill(1));
  assert.deepEqual(await fs.readFile(stage.file.path), new Uint8Array(12000).fill(2));
  await stage.cleanup!.remove();
});

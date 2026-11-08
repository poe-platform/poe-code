import assert from "node:assert/strict";
import { test } from "vitest";

import { FsError } from "../../../../src/contracts/errors.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { resolveEntryView } from "../../../../src/fs/mount/comparison.js";
import { createMountFileSystem } from "../../../../src/fs/mount/index.js";
import { getOwnedS3Entry } from "../../../../src/fs/s3/authority.js";
import type { S3HeadOutput,S3Transport } from "../../../../src/fs/s3/index.js";
import { MockS3Client,S3FileSystem } from "../../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";
import { getOwnedWebDavEntry } from "../../../../src/fs/webdav/resource-id.js";

import { MockDav } from "../webdav/mock.js";

const sourceBytes = new Uint8Array([0, 255, 19, 65, 10, 128]);
const targetBytes = new Uint8Array([79, 76, 68, 0]);
const keepBytes = new Uint8Array([75, 69, 69, 80]);

function opaque<Backend extends object>(backend: Backend, overrides: Partial<Backend> = {}): Backend {
  return new Proxy(backend, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

function mounted(left: FileSystem, right: FileSystem) {
  return createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
}

async function seed(filesystem: FileSystem) {
  await filesystem.writeFile("/source", sourceBytes);
  await filesystem.writeFile("/target", targetBytes);
  await filesystem.writeFile("/keep", keepBytes);
}

async function contents(filesystem: FileSystem) {
  return Object.fromEntries(await Promise.all((await filesystem.readdir("/")).map(async entry => [entry.name,
    entry.type === "file" ? [...await filesystem.readFile(`/${entry.name}`, { maxBytes: 1024 })] : entry.type])));
}

const original = () => ({ source: [...sourceBytes], target: [...targetBytes], keep: [...keepBytes] });
const observe = (name: string, value: unknown) => console.log(JSON.stringify({ review: name, value }));

async function failure(action: Promise<unknown>, code: string) {
  let caught: unknown;
  try { await action; } catch (error) { caught = error; }
  assert.ok(caught instanceof FsError, `expected typed ${code}`);
  observe("error", { code: caught.code, path: caught.path, dest: caught.dest, syscall: caught.syscall });
  assert.equal(caught.code, code);
}

function s3(store = new MockS3Client({ buckets: ["bucket"] }), transport: S3Transport = opaque(store)) {
  return { store, fs: new S3FileSystem({ bucket: "bucket", transport }) };
}

function dav(store = new MockDav()) {
  return { store, fs: new WebDavFileSystem({ baseUrl: "https://same.invalid/dav/", fetch: (url, init) => store.fetch(url, init), timeoutMs: 1000 }) };
}

test("06 fresh S3 HEAD authority rejects cached response and FS path stat replay", async () => {
  const store = new MockS3Client({ buckets: ["bucket"] });
  let cached: S3HeadOutput | undefined;
  let replay = false;
  const transport = opaque(store, { headObject: async (input, settings) => {
    if (replay && input.Key === "source") return cached!;
    const output = await store.headObject(input, settings);
    if (input.Key === "source") cached = output;
    return output;
  } });
  const fs = s3(store, transport).fs;
  await seed(fs);
  const view = await resolveEntryView(fs, "/source");
  assert.ok(getOwnedS3Entry(view));
  assert.equal(getOwnedS3Entry({ ...view, filesystem: s3(store).fs }), undefined);
  assert.equal(getOwnedS3Entry({ ...view, path: "/target" }), undefined);
  assert.equal(getOwnedS3Entry({ ...view, stat: { ...view.stat } }), undefined);
  replay = true;
  assert.equal(getOwnedS3Entry(await resolveEntryView(fs, "/source")), undefined);
  const memory = createMemoryFileSystem();
  await seed(memory);
  await failure(mounted(memory, fs).copyFile("/left/source", "/right/source"), "ENOTSUP");
  replay = false;
  assert.ok(getOwnedS3Entry(await resolveEntryView(fs, "/source")));
  assert.deepEqual(await contents(fs), original());
  assert.deepEqual(await contents(memory), original());
  observe("06", { files: await contents(fs), replay: "unknown; restored fresh observation accepted" });
});

test("07 DAV response authority binds exact FS path stat and does not follow response clones", async () => {
  const store = new MockDav();
  let clone = false;
  const fs = new WebDavFileSystem({ baseUrl: "https://same.invalid/dav/", fetch: async (url, init) => {
    const response = await store.fetch(url, init);
    return clone ? response.clone() : response;
  } });
  await seed(fs);
  const view = await resolveEntryView(fs, "/source");
  assert.ok(getOwnedWebDavEntry(view));
  assert.equal(getOwnedWebDavEntry({ ...view, filesystem: dav(store).fs }), undefined);
  assert.equal(getOwnedWebDavEntry({ ...view, path: "/target" }), undefined);
  assert.equal(getOwnedWebDavEntry({ ...view, stat: { ...view.stat } }), undefined);
  clone = true;
  assert.equal(getOwnedWebDavEntry(await resolveEntryView(fs, "/source")), undefined);
  const memory = createMemoryFileSystem();
  await seed(memory);
  await failure(mounted(memory, fs).copyFile("/left/source", "/right/target"), "ENOTSUP");
  clone = false;
  assert.deepEqual(await contents(fs), original());
  assert.deepEqual(await contents(memory), original());
  observe("07", { files: await contents(fs), clone: "no provider-owned cross-protocol authority" });
});

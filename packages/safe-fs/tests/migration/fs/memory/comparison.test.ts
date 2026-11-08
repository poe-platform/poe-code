import assert from "node:assert/strict";
import { test } from "vitest";

import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { compareResolvedEntries,resolveEntryView } from "../../../../src/fs/mount/comparison.js";
import { createMountFileSystem } from "../../../../src/fs/mount/index.js";
import { createS3Transport,MockS3Client,S3FileSystem } from "../../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";

import { MockDav } from "../webdav/mock.js";

const payload = new Uint8Array([0, 255, 128, 13, 10, 65]);
const previous = new Uint8Array([4, 0, 253]);
const baseUrl = "https://qualified.invalid/dav/";
type Kind = "s3" | "webdav";

function qualified(kind: Kind) {
  if (kind === "s3") {
    const service = new MockS3Client({ buckets: ["bucket"] });
    const filesystem = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(service, service.capabilities) });
    return { filesystem, operations: () => service.requests.map(request => request.operation) };
  }
  const service = new MockDav();
  const filesystem = new WebDavFileSystem({ baseUrl, fetch: service.createFetch(), requestStreamSupport: true });
  return { filesystem, operations: () => service.requests.map(request => request.init.method ?? "") };
}

function mounted(memory: FileSystem, remote: FileSystem) {
  return createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/memory": memory, "/remote": remote } });
}

for (const kind of ["s3", "webdav"] as const) {




  test(`qualified ${kind} preserves faithful decorators but rejects copied or wrong-path Memory observations`, async () => {
    const memory = new MemoryFileSystem();
    const { filesystem: remote } = qualified(kind);
    await memory.writeFile("/source", payload);
    await remote.writeFile("/target", previous);
    const own = await resolveEntryView(memory, "/source");
    const peer = await resolveEntryView(remote, "/target");
    assert.equal(await compareResolvedEntries({ ...own, stat: { ...own.stat } }, peer), "unknown");
    assert.equal(await compareResolvedEntries({ ...own, path: "/different" }, peer), "unknown");
    const original = memory.readFile;
    memory.readFile = (path, options) => original.call(memory, path, options);
    assert.equal(await memory.compareEntry("/source", remote, "/target"), "distinct");
    assert.deepEqual(await remote.readFile("/target"), previous);
    await mounted(memory, remote).copyFile("/memory/source", "/remote/target");
    assert.deepEqual(await memory.readFile("/source"), payload);
    assert.deepEqual(await remote.readFile("/target"), payload);
    assert.deepEqual(await memory.readdir("/"), [{ name: "source", type: "file" }]);
    assert.deepEqual(await remote.readdir("/"), [{ name: "target", type: "file" }]);
  });




}

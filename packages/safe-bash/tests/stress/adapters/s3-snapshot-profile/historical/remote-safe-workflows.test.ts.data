import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { FileSystem } from "../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { MockS3Client, S3FileSystem } from "../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { binary, errno } from "../../fs/conformance/fixtures.js";
import { MockDav } from "../../fs/webdav/mock.js";

interface RemoteFixture {
  fs: FileSystem;
  mutations(): number;
  snapshot(): Promise<unknown>;
}

const profiles: { name: string; create(): RemoteFixture }[] = [
  { name: "s3", create() {
    const bucket = "safe-workflows";
    const mock = new MockS3Client({ buckets: [bucket] });
    return {
      fs: new S3FileSystem({ transport: mock, bucket }),
      mutations: () => mock.requests.filter(request => ["putObject", "copyObject", "deleteObject"].includes(request.operation)).length,
      async snapshot() {
        const result = [];
        for (const entry of (await mock.listObjectsV2({ Bucket: bucket })).Contents ?? []) {
          const object = await mock.getObject({ Bucket: bucket, Key: entry.Key! });
          result.push({ key: entry.Key, body: object.Body, metadata: object.Metadata, etag: object.ETag });
        }
        return result;
      },
    };
  } },
  { name: "webdav", create() {
    const mock = new MockDav();
    return {
      fs: new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch }),
      mutations: () => mock.requests.filter(request => !["PROPFIND", "GET", "HEAD"].includes(request.init.method!)).length,
      async snapshot() { return structuredClone(mock.files); },
    };
  } },
];

for (const profile of profiles) {
  test(`${profile.name}: named-file cleanup leaves parents and unsupported empty rmdir has no effects`, async () => {
    const fixture = profile.create();
    const { fs } = fixture;
    const nested = "/work/scratch/nested";
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(`${nested}/owned-file`, binary);
    await fs.writeFile("/sentinel", new Uint8Array([255, 3]));
    await fs.rm(`${nested}/owned-file`);
    await assert.rejects(fs.stat(`${nested}/owned-file`), errno("ENOENT"));
    assert.deepEqual(await fs.readdir(nested), []);
    const before = await fixture.snapshot();
    const mutations = fixture.mutations();
    assert.ok(fs.rmdir);
    await assert.rejects(fs.rmdir(nested), error => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, "ENOTSUP");
      assert.equal(error.syscall, "rmdir");
      assert.equal(error.path, nested);
      return true;
    });
    assert.equal(fixture.mutations(), mutations);
    assert.deepEqual(await fixture.snapshot(), before);
    for (const path of ["/work", "/work/scratch", nested]) assert.equal((await fs.stat(path)).type, "directory");
    assert.deepEqual(await fs.readFile("/sentinel"), new Uint8Array([255, 3]));
  });

  test(`${profile.name}: explicitly destructive subtree deletion is distinct from empty-only removal`, async () => {
    const { fs } = profile.create();
    await fs.mkdir("/discard/nested", { recursive: true });
    await fs.writeFile("/discard/nested/child", binary);
    await fs.writeFile("/discard-neighbor", new Uint8Array([7, 255]));
    await fs.rm("/discard", { recursive: true });
    await assert.rejects(fs.stat("/discard"), errno("ENOENT"));
    await assert.rejects(fs.stat("/discard/nested/child"), errno("ENOENT"));
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["discard-neighbor"]);
    assert.deepEqual(await fs.readFile("/discard-neighbor"), new Uint8Array([7, 255]));
  });

  test(`${profile.name}: bounded memory staging publishes named bytes exclusively and cleans only local parents`, async () => {
    const { fs: remote } = profile.create();
    const local = new MemoryFileSystem();
    const signal = new AbortController().signal;
    await local.mkdir("/work/scratch/nested", { recursive: true, signal });
    await local.writeFile("/work/scratch/nested/result", binary, { signal });
    await remote.mkdir("/output", { signal });
    const payload = await local.readFile("/work/scratch/nested/result", { maxBytes: binary.length, signal });
    await remote.writeFile("/output/result", payload, { flag: "wx", signal });
    assert.deepEqual(await remote.readFile("/output/result", { maxBytes: binary.length, signal }), binary);
    await assert.rejects(remote.writeFile("/output/result", new Uint8Array([9]), { flag: "wx", signal }), errno("EEXIST"));
    assert.deepEqual(await remote.readFile("/output/result"), binary);
    await local.rm("/work/scratch/nested/result", { signal });
    for (const path of ["/work/scratch/nested", "/work/scratch", "/work"]) await local.rmdir(path, { signal });
    assert.deepEqual(await local.readdir("/"), []);
    assert.deepEqual((await remote.readdir("/")).map(entry => entry.name), ["output"]);
    assert.deepEqual((await remote.readdir("/output")).map(entry => entry.name), ["result"]);
    assert.deepEqual(await remote.readFile("/output/result"), binary);
  });
}

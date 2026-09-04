import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { FsOptions } from "../src/contracts/filesystem.js";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { MockS3Client } from "../src/fs/s3/mock.js";
import type { S3ListOutput } from "../src/fs/s3/transport.js";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { multistatus, resource, xmlResponse } from "./migration/fs/webdav/mock.js";

const bounded = (maxEntries: number, signal?: AbortSignal): FsOptions & { maxEntries: number } => ({ maxEntries, ...(signal ? { signal } : {}) });
function s3(pages: S3ListOutput[]) {
  const transport = new MockS3Client({ buckets: ["bucket"] });
  let index = 0;
  const list = vi.spyOn(transport, "listObjectsV2").mockImplementation(async input => {
    if (input.Delimiter === undefined) return { Contents: [] };
    assert.ok(index < pages.length, "unexpected listing request after admission failed");
    return pages[index++]!;
  });
  return { fs: new S3FileSystem({ transport, bucket: "bucket", prefix: "scope" }), list };
}
const object = (name: string) => ({ Key: `scope/${name}`, Size: 0 });

test("S3 caps requested pages and stops before a post-overflow request", async () => {
  const { fs, list } = s3([
    { Contents: [object("a")], IsTruncated: true, NextContinuationToken: "next" },
    { Contents: [object("a"), object("b")], IsTruncated: true, NextContinuationToken: "never" },
    { Contents: [object("c")] },
  ]);
  await assert.rejects(fs.readdir("/", bounded(1)), { code: "EFBIG" });
  assert.equal(list.mock.calls.filter(([input]) => input.Delimiter === "/").length, 2);
  assert.ok(list.mock.calls.every(([input]) => input.MaxKeys! >= 1 && input.MaxKeys! <= 2));
});

test("S3 excludes its directory marker and counts distinct children across pages", async () => {
  const { fs, list } = s3([
    { Contents: [object(""), object("a")], IsTruncated: true, NextContinuationToken: "next" },
    { Contents: [object("a")], CommonPrefixes: [{ Prefix: "scope/b/" }] },
  ]);
  assert.deepEqual(await fs.readdir("/", bounded(2)), [{ name: "a", type: "file" }, { name: "b", type: "directory" }]);
  assert.ok(list.mock.calls.every(([input]) => input.MaxKeys! <= 3));
  const empty = s3([{ Contents: [object("")] }]);
  assert.deepEqual(await empty.fs.readdir("/", bounded(0)), []);
  assert.equal(empty.list.mock.calls[0]?.[0].MaxKeys, 1);
});

test("S3 preserves omitted paging, collisions and continuation-token validation", async () => {
  const legacy = s3([{ Contents: [object("b"), object("a")] }]);
  assert.deepEqual((await legacy.fs.readdir("/")).map(entry => entry.name), ["a", "b"]);
  assert.equal(legacy.list.mock.calls.find(([input]) => input.Delimiter === "/")?.[0].MaxKeys, 1000);
  const collision = s3([{ Contents: [object("a")], CommonPrefixes: [{ Prefix: "scope/a/" }] }]);
  await assert.rejects(collision.fs.readdir("/", bounded(1)), { code: "ENOTSUP" });
  const repeated = s3([
    { Contents: [object("a")], IsTruncated: true, NextContinuationToken: "repeat" },
    { Contents: [object("a")], IsTruncated: true, NextContinuationToken: "repeat" },
  ]);
  await assert.rejects(repeated.fs.readdir("/", bounded(1)), { code: "EIO" });
  assert.equal(repeated.list.mock.calls.filter(([input]) => input.Delimiter === "/").length, 2);
});

test("WebDAV rejects the next child before constructing or validating its stat", async () => {
  const xml = multistatus(resource("/dav/", true), resource("/dav/a"), resource("/dav/b", false, NaN));
  const fetch = vi.fn(async () => xmlResponse(xml));
  const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch });
  await assert.rejects(fs.readdir("/", bounded(1)), { code: "EFBIG" });
  assert.equal(fetch.mock.calls.length, 1);
});

test("WebDAV excludes the requested resource even when listed last", async () => {
  const fetch = vi.fn(async () => xmlResponse(multistatus(resource("/dav/b"), resource("/dav/a"), resource("/dav/", true))));
  const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch });
  assert.deepEqual((await fs.readdir("/", bounded(2))).map(entry => entry.name), ["a", "b"]);
  await assert.rejects(fs.readdir("/", bounded(1)), { code: "EFBIG" });
  const empty = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: async () => xmlResponse(multistatus(resource("/dav/", true))) });
  assert.deepEqual(await empty.readdir("/", bounded(0)), []);
});

test("WebDAV preserves duplicate and out-of-depth response errors", async () => {
  for (const [children, code] of [
    [[resource("/dav/a"), resource("/dav/a")], "EIO"],
    [[resource("/dav/a/b")], "EACCES"],
  ] as const) {
    const fs = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: async () => xmlResponse(multistatus(resource("/dav/", true), ...children)) });
    await assert.rejects(fs.readdir("/", bounded(1)), { code });
  }
});

for (const adapter of ["S3", "WebDAV"] as const) test(`${adapter} validates limits before transport while preserving typed caller cancellation`, async () => {
  const transport = new MockS3Client({ buckets: ["bucket"] });
  const list = vi.spyOn(transport, "listObjectsV2");
  const fetch = vi.fn(async () => xmlResponse(multistatus(resource("/dav/", true))));
  const fs = adapter === "S3" ? new S3FileSystem({ transport, bucket: "bucket" }) : new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch });
  for (const value of [-1, 0.5, Infinity, NaN]) await assert.rejects(fs.readdir("/", bounded(value)), { code: "EINVAL" });
  const caller = new AbortController(); caller.abort(false);
  await assert.rejects(fs.readdir("/", bounded(-1, caller.signal)), { code: "ECANCELED" });
  assert.equal(list.mock.calls.length, 0); assert.equal(fetch.mock.calls.length, 0);
});

for (const adapter of ["S3", "WebDAV"] as const) test(`${adapter} keeps response-time cancellation primary over entry overflow`, async () => {
  const caller = new AbortController();
  const transport = new MockS3Client({ buckets: ["bucket"] });
  transport.listObjectsV2 = async input => {
    if (input.Delimiter === undefined) return { Contents: [] };
    caller.abort(null);
    return { Contents: [{ Key: "a", Size: 0 }] };
  };
  const fs = adapter === "S3" ? new S3FileSystem({ transport, bucket: "bucket" }) : new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: async () => {
    caller.abort(null);
    return xmlResponse(multistatus(resource("/dav/", true), resource("/dav/a")));
  } });
  await assert.rejects(fs.readdir("/", bounded(0, caller.signal)), { code: "ECANCELED" });
});

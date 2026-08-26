import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { isFsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import type { FileSystem } from "../../../src/contracts/filesystem.js";
import {
  createS3Transport, MockS3Client, S3FileSystem, S3RenameError, S3ServiceError,
} from "../../../src/fs/s3/index.js";
import type {
  MockS3ClientOptions, S3FileSystemOptions, S3PutInput, S3Transport,
} from "../../../src/fs/s3/index.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (data: Uint8Array): string => new TextDecoder().decode(data);
const errno = (code: ErrnoCode) => (error: unknown): boolean => isFsError(error, code);

function fixture(options: Partial<S3FileSystemOptions> = {}, mockOptions: Partial<MockS3ClientOptions> = {}) {
  const client = new MockS3Client({ buckets: ["bucket"], ...mockOptions });
  const fs = new S3FileSystem({ bucket: "bucket", prefix: "mount", transport: client, ...options });
  return { client, fs };
}

async function seed(client: MockS3Client, key: string, value = ""): Promise<void> {
  await client.putObject({ Bucket: "bucket", Key: key, Body: bytes(value) });
}

test("S3 adapter conforms to FileSystem and construction is offline with explicit transport", async () => {
  const { client, fs } = fixture();
  const contract: FileSystem = fs;
  assert.equal(client.requests.length, 0);
  assert.equal(contract.capabilities.atomicRename, false);
  assert.equal(contract.capabilities.permissions, false);
  assert.throws(() => new S3FileSystem({ bucket: "bucket" } as S3FileSystemOptions), errno("EINVAL"));
  assert.equal((await contract.stat("/")).type, "directory");
  assert.deepEqual(await contract.readdir("/"), []);
});

test("file operations preserve empty bytes, invalid UTF-8, NULs, and caller buffer ownership", async () => {
  const { fs } = fixture();
  await fs.writeFile("/empty", new Uint8Array());
  assert.deepEqual(await fs.readFile("/empty", { maxBytes: 0 }), new Uint8Array());
  const original = new Uint8Array([0, 255, 254, 128, 13, 10]);
  const writing = fs.writeFile("/binary", original);
  original.fill(1);
  await writing;
  const first = await fs.readFile("/binary");
  assert.deepEqual(first, new Uint8Array([0, 255, 254, 128, 13, 10]));
  first.fill(2);
  assert.deepEqual(await fs.readFile("/binary"), new Uint8Array([0, 255, 254, 128, 13, 10]));
  assert.equal((await fs.stat("/binary")).size, 6);
  await fs.writeFile("/binary", bytes("replacement"));
  assert.equal(text(await fs.readFile("/binary")), "replacement");
});

test("explicit and implicit directories project object prefixes without leaking neighboring prefixes", async () => {
  const { client, fs } = fixture({}, { pageSize: 1 });
  await seed(client, "mount/implicit/nested/file", "content");
  await seed(client, "mount-other/secret", "never visible");
  await fs.mkdir("/empty");
  await fs.mkdir("/parent/child", { recursive: true });
  assert.deepEqual(await fs.readdir("/"), [
    { name: "empty", type: "directory" }, { name: "implicit", type: "directory" }, { name: "parent", type: "directory" },
  ]);
  assert.equal((await fs.stat("/implicit")).type, "directory");
  assert.equal(text(await fs.readFile("/implicit/nested/file")), "content");
  assert.equal((await client.headObject({ Bucket: "bucket", Key: "mount/empty/" })).ContentLength, 0);
  assert.deepEqual(await fs.readdir("/empty"), []);
});

test("mkdir, file parents, missing paths, suffixes, and nonempty removal report contract errors", async () => {
  const { fs } = fixture();
  await assert.rejects(fs.readFile("/missing"), errno("ENOENT"));
  await assert.rejects(fs.mkdir("/missing/child"), errno("ENOENT"));
  await assert.rejects(fs.writeFile("/missing/child", bytes("value")), errno("ENOENT"));
  await fs.writeFile("/file", bytes("value"));
  await assert.rejects(fs.writeFile("/file/child", bytes("value")), errno("ENOTDIR"));
  await assert.rejects(fs.stat("/file/"), errno("ENOTDIR"));
  await assert.rejects(fs.readdir("/file"), errno("ENOTDIR"));
  await assert.rejects(fs.mkdir("/file"), errno("EEXIST"));
  await fs.mkdir("/dir");
  await assert.rejects(fs.mkdir("/dir"), errno("EEXIST"));
  await fs.mkdir("/dir", { recursive: true });
  await assert.rejects(fs.readFile("/dir"), errno("EISDIR"));
  await assert.rejects(fs.writeFile("/dir", bytes("value")), errno("EISDIR"));
  await fs.writeFile("/dir/file", bytes("value"));
  await assert.rejects(fs.rm("/dir"), errno("ENOTEMPTY"));
  await assert.rejects(fs.rm("/", { recursive: true }), errno("EBUSY"));
  await fs.rm("/missing", { force: true });
  await fs.rm("/absent/child", { force: true });
  await assert.rejects(fs.rm("/missing"), errno("ENOENT"));
  await fs.mkdir("/empty");
  await fs.rm("/empty");
  await assert.rejects(fs.stat("/empty"), errno("ENOENT"));
});

test("all mutating and reading paths reject escape attempts before transport access", async () => {
  const { fs, client } = fixture();
  for (const path of ["../outside", "/../../outside", "/inside/../../outside"]) {
    await assert.rejects(fs.readFile(path), errno("EACCES"));
    await assert.rejects(fs.writeFile(path, bytes("value")), errno("EACCES"));
    await assert.rejects(fs.mkdir(path), errno("EACCES"));
    await assert.rejects(fs.rm(path, { force: true }), errno("EACCES"));
    await assert.rejects(fs.copyFile("/source", path), errno("EACCES"));
    await assert.rejects(fs.rename(path, "/destination"), errno("EACCES"));
  }
  assert.equal(client.requests.length, 0);
  await assert.rejects(fs.stat("/nul\0byte"), errno("EINVAL"));
  await assert.rejects(fs.stat("/unpaired\ud800"), errno("EINVAL"));
});

test("literal percent escapes, backslashes, Unicode, and spaces do not become path traversal", async () => {
  const { client, fs } = fixture();
  for (const name of ["%2e%2e", "%2F", "a\\b", "space + # ?", "😀é"]) {
    await fs.writeFile(`/${name}`, bytes(name));
    assert.equal(text(await fs.readFile(`/${name}`)), name);
    assert.equal(text((await client.getObject({ Bucket: "bucket", Key: `mount/${name}` })).Body as Uint8Array), name);
  }
  await fs.writeFile("//normalized/.././name", bytes("normalized"));
  assert.equal(await fs.realpath("./name"), "/name");
  assert.deepEqual(await fs.lstat("name"), await fs.stat("/name"));
});

test("prefixes and limits validate before any requests and object key byte limits include prefix", async () => {
  const { client } = fixture();
  for (const prefix of ["/absolute", "../escape", "a/../b", "a//b", "nul\0", "\ud800"]) {
    assert.throws(() => new S3FileSystem({ transport: client, bucket: "bucket", prefix }), errno("EINVAL"));
  }
  for (const options of [{ pageSize: 0 }, { pageSize: 1001 }, { maxReadBytes: -1 }, { maxListEntries: 0 }]) {
    assert.throws(() => new S3FileSystem({ transport: client, bucket: "bucket", ...options }), errno("EINVAL"));
  }
  assert.equal(client.requests.length, 0);
  const { fs } = fixture();
  const key = "x".repeat(1018);
  await fs.writeFile(`/${key}`, bytes("fits"));
  assert.equal(text(await fs.readFile(`/${key}`)), "fits");
  await assert.rejects(fs.writeFile(`/${key}x`, bytes("too long")), errno("ENAMETOOLONG"));
  await assert.rejects(fs.mkdir(`/${key}`), errno("EEXIST"));
  await assert.rejects(fs.mkdir(`/${"y".repeat(1018)}`), errno("ENAMETOOLONG"));
});

test("readdir traverses more than 1000 objects and recursive rm snapshots every page before deleting", async () => {
  const { fs, client } = fixture({ pageSize: 137 });
  for (let index = 0; index < 1103; index++) await seed(client, `mount/tree/file-${String(index).padStart(4, "0")}`, String(index));
  await seed(client, "mount/tree-other/file", "keep");
  assert.equal((await fs.readdir("/tree")).length, 1103);
  await fs.rm("/tree", { recursive: true });
  await assert.rejects(fs.stat("/tree"), errno("ENOENT"));
  assert.equal(text(await fs.readFile("/tree-other/file")), "keep");
  const deletes = client.requests.filter((request) => request.operation === "deleteObject");
  assert.equal(deletes.length, 1103);
  const firstDelete = client.requests.findIndex((request) => request.operation === "deleteObject");
  assert.equal(client.requests.slice(firstDelete, firstDelete + 1103).every((request) => request.operation === "deleteObject"), true);
});

test("listing resource limits fail before recursive deletion modifies any objects", async () => {
  const { fs, client } = fixture({ maxListEntries: 2 }, { pageSize: 1 });
  for (const key of ["mount/tree/a", "mount/tree/b", "mount/tree/c"]) await seed(client, key);
  await assert.rejects(fs.readdir("/tree"), errno("EFBIG"));
  await assert.rejects(fs.rm("/tree", { recursive: true }), errno("EFBIG"));
  assert.equal(client.requests.some((request) => request.operation === "deleteObject"), false);
});

for (const malformed of ["missing-token", "repeated-token", "escaped-key", "bad-size", "escaped-prefix", "invalid-truncated"] as const) {
  test(`malformed list response fails closed: ${malformed}`, async () => {
    const client = new MockS3Client({ buckets: ["bucket"] });
    const transport: S3Transport = {
      ...createS3Transport(client),
      async listObjectsV2(input) {
        if (input.MaxKeys === 1) return { Contents: [] };
        switch (malformed) {
          case "missing-token": return { IsTruncated: true };
          case "repeated-token": return { IsTruncated: true, NextContinuationToken: "same" };
          case "escaped-key": return { Contents: [{ Key: "outside/secret", Size: 0 }] };
          case "bad-size": return { Contents: [{ Key: "mount/file", Size: -1 }] };
          case "escaped-prefix": return { CommonPrefixes: [{ Prefix: "outside/" }] };
          case "invalid-truncated": return { IsTruncated: "false" as unknown as boolean };
        }
      },
    };
    const fs = new S3FileSystem({ transport, bucket: "bucket", prefix: "mount" });
    await assert.rejects(fs.readdir("/"), errno("EIO"));
  });
}

test("zero-item truncated pages are followed rather than treated as end-of-list", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const transport: S3Transport = {
    ...createS3Transport(client),
    async listObjectsV2(input) {
      if (input.MaxKeys === 1) return {};
      return input.ContinuationToken === undefined
        ? { IsTruncated: true, NextContinuationToken: "continue" }
        : { IsTruncated: false, Contents: [{ Key: "mount/last", Size: 0 }] };
    },
  };
  const fs = new S3FileSystem({ transport, bucket: "bucket", prefix: "mount" });
  assert.deepEqual(await fs.readdir("/"), [{ name: "last", type: "file" }]);
});

test("implicit directory existence follows empty truncated pages", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  await seed(client, "mount/implicit/child", "data");
  const transport: S3Transport = {
    ...createS3Transport(client),
    async listObjectsV2(input, options) {
      if (input.Prefix === "mount/implicit/" && input.ContinuationToken === undefined) {
        return { Contents: [], IsTruncated: true, NextContinuationToken: "empty-first-page" };
      }
      if (input.ContinuationToken === "empty-first-page") {
        const { ContinuationToken: _token, ...rest } = input;
        return client.listObjectsV2(rest, options);
      }
      return client.listObjectsV2(input, options);
    },
  };
  const fs = new S3FileSystem({ transport, bucket: "bucket", prefix: "mount" });
  assert.equal((await fs.stat("/implicit")).type, "directory");
  assert.equal(text(await fs.readFile("/implicit/child")), "data");
});

test("ambiguous file/prefix collisions are not silently hidden or deleted", async () => {
  const { fs, client } = fixture();
  await seed(client, "mount/collision", "file");
  await seed(client, "mount/collision/child", "child");
  await assert.rejects(fs.stat("/collision"), errno("ENOTSUP"));
  await assert.rejects(fs.readdir("/"), errno("ENOTSUP"));
  await assert.rejects(fs.readFile("/collision/child"), errno("ENOTSUP"));
  await assert.rejects(fs.rm("/collision", { recursive: true }), errno("ENOTSUP"));
  assert.equal(client.requests.some((request) => request.operation === "deleteObject"), false);
});

for (const key of ["mount/tree/../escape", "mount/tree//double", "mount/tree/./dot", "mount/tree/nonempty/"]) {
  test(`unrepresentable remote key is rejected without data loss: ${JSON.stringify(key)}`, async () => {
    const { fs, client } = fixture();
    await seed(client, "mount/tree/", "");
    await seed(client, key, "data");
    await assert.rejects(fs.rm("/tree", { recursive: true }), errno("ENOTSUP"));
    assert.equal(client.requests.some((request) => request.operation === "deleteObject"), false);
  });
}

test("nested file/prefix collisions are discovered during destructive preflight", async () => {
  const { fs, client } = fixture();
  await seed(client, "mount/tree/", "");
  await seed(client, "mount/tree/branch", "file");
  await seed(client, "mount/tree/branch/child", "child");
  await assert.rejects(fs.rm("/tree", { recursive: true }), errno("ENOTSUP"));
  assert.equal(client.requests.some((request) => request.operation === "deleteObject"), false);
});

test("exclusive writes and appends use service preconditions and preserve bytes and user metadata", async () => {
  const { fs, client } = fixture();
  await fs.writeFile("/new", bytes("first"), { flag: "wx" });
  await assert.rejects(fs.writeFile("/new", bytes("second"), { flag: "wx" }), errno("EEXIST"));
  await assert.rejects(fs.writeFile("/new", bytes("second"), { flag: "ax" }), errno("EEXIST"));
  await client.putObject({ Bucket: "bucket", Key: "mount/meta", Body: new Uint8Array([0, 255]), Metadata: { custom: "preserved" } });
  await fs.appendFile("/meta", new Uint8Array([128]));
  assert.deepEqual(await fs.readFile("/meta"), new Uint8Array([0, 255, 128]));
  assert.deepEqual((await client.headObject({ Bucket: "bucket", Key: "mount/meta" })).Metadata, { custom: "preserved" });
  await fs.appendFile("/created", bytes("created"));
  assert.equal(text(await fs.readFile("/created")), "created");
  assert.equal(client.requests.some((request) => request.operation === "putObject" && (request.input as S3PutInput).IfMatch !== undefined), true);
});

test("concurrent append rejects a stale ETag instead of losing a competing write", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  let compete = true;
  const transport: S3Transport = {
    ...createS3Transport(client, client.capabilities),
    async putObject(input, options) {
      if (input.IfMatch && compete) {
        compete = false;
        await client.putObject({ Bucket: input.Bucket, Key: input.Key, Body: bytes("competitor") });
      }
      return client.putObject(input, options);
    },
  };
  const fs = new S3FileSystem({ transport, bucket: "bucket", prefix: "mount" });
  await fs.writeFile("/file", bytes("original"));
  await assert.rejects(fs.appendFile("/file", bytes("append")), errno("EAGAIN"));
  assert.equal(text(await fs.readFile("/file")), "competitor");
});

test("concurrent exclusive create reports EEXIST without overwriting the winner", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const transport: S3Transport = {
    ...createS3Transport(client, client.capabilities),
    async putObject(input, options) {
      if (input.IfNoneMatch) await client.putObject({ Bucket: input.Bucket, Key: input.Key, Body: bytes("winner") });
      return client.putObject(input, options);
    },
  };
  const fs = new S3FileSystem({ transport, bucket: "bucket" });
  await assert.rejects(fs.writeFile("/file", bytes("loser"), { flag: "wx" }), errno("EEXIST"));
  assert.equal(text(await fs.readFile("/file")), "winner");
});

test("unsupported conditional operations fail rather than emulating unsafe check-then-write", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const transport = createS3Transport(client);
  const fs = new S3FileSystem({ transport, bucket: "bucket", allowNonAtomicRename: true });
  await fs.writeFile("/file", bytes("ordinary"));
  await assert.rejects(fs.appendFile("/file", bytes("append")), errno("ENOTSUP"));
  await assert.rejects(fs.writeFile("/new", bytes("exclusive"), { flag: "wx" }), errno("ENOTSUP"));
  await assert.rejects(fs.copyFile("/file", "/copy", { exclusive: true }), errno("ENOTSUP"));
  await assert.rejects(fs.rename("/file", "/rename"), errno("ENOTSUP"));
});

test("copy uses server-side CopyObject with source ETag and encoded keys, including binary data", async () => {
  const { fs, client } = fixture();
  const source = "/space ? %2F # é";
  await fs.writeFile(source, new Uint8Array([0, 255]));
  await fs.copyFile(source, "/copy", { exclusive: true });
  assert.deepEqual(await fs.readFile("/copy"), new Uint8Array([0, 255]));
  const copy = client.requests.find((request) => request.operation === "copyObject");
  assert.ok(copy && "CopySource" in copy.input);
  assert.equal(copy.input.CopySource, "bucket/mount/space%20%3F%20%252F%20%23%20%C3%A9");
  assert.equal(copy.input.IfNoneMatch, "*");
  assert.ok(copy.input.CopySourceIfMatch);
  await assert.rejects(fs.copyFile(source, "/copy", { exclusive: true }), errno("EEXIST"));
  await fs.copyFile(source, source);
  await assert.rejects(fs.copyFile("/", "/copy"), errno("EISDIR"));
});

test("explicitly disabling non-atomic rename rejects before accessing the transport", async () => {
  const { fs, client } = fixture({ allowNonAtomicRename: false });
  await assert.rejects(fs.rename("/old", "/new"), errno("ENOTSUP"));
  assert.equal(client.requests.length, 0);
});

test("non-atomic rename copies all paginated objects before deleting any source", async () => {
  const { fs, client } = fixture({ allowNonAtomicRename: true }, { pageSize: 1 });
  await fs.mkdir("/old/empty", { recursive: true });
  await fs.writeFile("/old/one", bytes("one"));
  await fs.writeFile("/old/two", new Uint8Array([0, 255]));
  await fs.rename("/old", "/new");
  assert.equal(text(await fs.readFile("/new/one")), "one");
  assert.deepEqual(await fs.readFile("/new/two"), new Uint8Array([0, 255]));
  assert.deepEqual(await fs.readdir("/new/empty"), []);
  await assert.rejects(fs.stat("/old"), errno("ENOENT"));
  const mutations = client.requests.filter((request) => ["copyObject", "deleteObject"].includes(request.operation));
  assert.deepEqual(mutations.map((request) => request.operation), ["copyObject", "copyObject", "copyObject", "copyObject", "deleteObject", "deleteObject", "deleteObject", "deleteObject"]);
  assert.equal(mutations.filter((request) => request.operation === "deleteObject").every((request) => "IfMatch" in request.input), true);
});

test("rename rejects invalid directory moves and incompatible destinations without modifying source", async () => {
  const { fs } = fixture({ allowNonAtomicRename: true });
  await fs.mkdir("/source");
  await fs.writeFile("/source/child", bytes("data"));
  await fs.writeFile("/file", bytes("file"));
  await fs.mkdir("/dest");
  await fs.writeFile("/dest/child", bytes("other"));
  await assert.rejects(fs.rename("/source", "/source/child/new"), errno("EINVAL"));
  await assert.rejects(fs.rename("/source", "/file"), errno("ENOTDIR"));
  await assert.rejects(fs.rename("/file", "/dest"), errno("EISDIR"));
  await assert.rejects(fs.rename("/source", "/dest"), errno("ENOTEMPTY"));
  await assert.rejects(fs.rename("/source", "/"), errno("EBUSY"));
  await fs.rename("/source", "/source");
  await assert.rejects(fs.rename("/file", "/file/"), errno("ENOTDIR"));
  assert.equal(text(await fs.readFile("/source/child")), "data");
});

test("rename may replace a file or empty directory and does not delete unrelated prefixes", async () => {
  const { fs, client } = fixture({ allowNonAtomicRename: true });
  await fs.writeFile("/old", bytes("new data"));
  await fs.writeFile("/target", bytes("old data"));
  await fs.rename("/old", "/target");
  assert.equal(text(await fs.readFile("/target")), "new data");
  await seed(client, "mount/implicit/child", "child");
  await fs.mkdir("/empty");
  await fs.rename("/implicit", "/empty");
  assert.equal(text(await fs.readFile("/empty/child")), "child");
  await fs.mkdir("/empty-source");
  await fs.rename("/empty-source", "/empty-target");
  assert.deepEqual(await fs.readdir("/empty-target"), []);
});

test("copy failure during rename retains every source and reports completed destination copies", async () => {
  let copies = 0;
  const { fs, client } = fixture({ allowNonAtomicRename: true }, { authorize(request) {
    if (request.operation === "copyObject" && ++copies === 2) throw new S3ServiceError("AccessDenied", 403);
  } });
  await seed(client, "mount/source/a", "a");
  await seed(client, "mount/source/b", "b");
  await assert.rejects(fs.rename("/source", "/dest"), (error: unknown) => {
    assert.ok(error instanceof S3RenameError);
    assert.equal(error.code, "EACCES");
    assert.equal(error.phase, "copy");
    assert.deepEqual(error.copiedKeys, ["mount/dest/a"]);
    assert.deepEqual(error.deletedKeys, []);
    return true;
  });
  assert.equal(text(await fs.readFile("/source/a")), "a");
  assert.equal(text(await fs.readFile("/source/b")), "b");
  assert.equal(client.requests.some((request) => request.operation === "deleteObject"), false);
});

test("delete failure during rename reports partial source deletion without rolling back destination copies", async () => {
  let deletes = 0;
  const { fs, client } = fixture({ allowNonAtomicRename: true }, { authorize(request) {
    if (request.operation === "deleteObject" && ++deletes === 2) throw new S3ServiceError("AccessDenied", 403);
  } });
  await seed(client, "mount/source/a", "a");
  await seed(client, "mount/source/b", "b");
  await assert.rejects(fs.rename("/source", "/dest"), (error: unknown) => {
    assert.ok(error instanceof S3RenameError);
    assert.equal(error.phase, "delete");
    assert.deepEqual(error.copiedKeys, ["mount/dest/a", "mount/dest/b"]);
    assert.deepEqual(error.deletedKeys, ["mount/source/a"]);
    return true;
  });
  assert.equal(text(await fs.readFile("/dest/a")), "a");
  assert.equal(text(await fs.readFile("/dest/b")), "b");
  assert.equal(text(await fs.readFile("/source/b")), "b");
});

test("conditional rename deletion preserves a source concurrently changed after copy", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  let compete = true;
  const transport: S3Transport = {
    ...createS3Transport(client, client.capabilities),
    async deleteObject(input, options) {
      if (compete) {
        compete = false;
        await client.putObject({ Bucket: input.Bucket, Key: input.Key, Body: bytes("concurrent change") });
      }
      return client.deleteObject(input, options);
    },
  };
  const fs = new S3FileSystem({ transport, bucket: "bucket", allowNonAtomicRename: true });
  await fs.writeFile("/source", bytes("original"));
  await assert.rejects(fs.rename("/source", "/destination"), errno("EAGAIN"));
  assert.equal(text(await fs.readFile("/source")), "concurrent change");
  assert.equal(text(await fs.readFile("/destination")), "original");
});

test("unconfirmed CopyObject success never permits source deletion", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const transport: S3Transport = { ...createS3Transport(client, client.capabilities), async copyObject() { return {}; } };
  const fs = new S3FileSystem({ transport, bucket: "bucket", allowNonAtomicRename: true });
  await fs.writeFile("/source", bytes("original"));
  await assert.rejects(fs.rename("/source", "/destination"), errno("EIO"));
  assert.equal(client.requests.some((request) => request.operation === "deleteObject"), false);
  assert.equal(text(await fs.readFile("/source")), "original");
});

for (const [service, status, expected] of [
  ["AccessDenied", 403, "EACCES"], ["InvalidAccessKeyId", 403, "EACCES"], ["SignatureDoesNotMatch", 403, "EACCES"],
  ["ExpiredToken", 403, "EACCES"], ["SlowDown", 503, "EAGAIN"], ["RequestTimeout", 408, "ETIMEDOUT"],
  ["NotImplemented", 501, "ENOTSUP"], ["InternalError", 500, "EIO"], ["InvalidArgument", 400, "EINVAL"],
] as const) {
  test(`service error ${service} becomes ${expected} without exposing it as a missing file`, async () => {
    const { fs } = fixture({}, { authorize() { throw new S3ServiceError(service, status); } });
    await assert.rejects(fs.stat("/file"), errno(expected));
    await assert.rejects(fs.rm("/file", { force: true }), errno(expected));
  });
}

test("missing bucket is not treated as a missing object or lazily provisioned", async () => {
  const { fs, client } = fixture({ bucket: "missing" });
  await assert.rejects(fs.stat("/"), errno("ENOENT"));
  await assert.rejects(fs.writeFile("/file", bytes("value")), errno("ENOENT"));
  await assert.rejects(fs.rm("/file", { force: true }), errno("ENOENT"));
  assert.equal(client.requests.some((request) => request.operation === "putObject"), false);
});

test("readOnly policy blocks every mutation before transport calls", async () => {
  const { fs, client } = fixture({ readOnly: true, allowNonAtomicRename: true });
  const actions = [
    () => fs.writeFile("/file", bytes("value")), () => fs.appendFile("/file", bytes("value")),
    () => fs.mkdir("/dir"), () => fs.rm("/file", { force: true }),
    () => fs.copyFile("/a", "/b"), () => fs.rename("/a", "/b"),
  ];
  for (const action of actions) await assert.rejects(action(), errno("EROFS"));
  assert.equal(client.requests.length, 0);
});

test("abort signals are checked before IO and passed through the transport", async () => {
  const { fs, client } = fixture();
  const signal = AbortSignal.abort();
  await assert.rejects(fs.stat("/", { signal }), errno("ECANCELED"));
  await assert.rejects(fs.writeFile("/file", bytes("value"), { signal }), errno("ECANCELED"));
  assert.equal(client.requests.length, 0);
  const controller = new AbortController();
  const transport: S3Transport = {
    ...createS3Transport(client),
    async listObjectsV2(_input, options) {
      assert.equal(options?.abortSignal, controller.signal);
      controller.abort();
      throw new Error("transport aborted");
    },
  };
  const aborting = new S3FileSystem({ transport, bucket: "bucket" });
  await assert.rejects(aborting.stat("/", { signal: controller.signal }), errno("ECANCELED"));
});

test("read limits and invalid flags fail; valid creation modes persist as metadata", async () => {
  const { fs } = fixture({ maxReadBytes: 4 });
  await fs.writeFile("/file", bytes("1234"));
  assert.equal(text(await fs.readFile("/file", { maxBytes: 4 })), "1234");
  await assert.rejects(fs.readFile("/file", { maxBytes: 3 }), errno("EFBIG"));
  await assert.rejects(fs.readFile("/file", { maxBytes: -1 }), errno("EINVAL"));
  await assert.rejects(fs.appendFile("/file", bytes("5")), errno("EFBIG"));
  await fs.writeFile("/created", bytes("value"), { mode: 0o600 });
  await fs.mkdir("/dir", { mode: 0o700 });
  assert.equal((await fs.stat("/created")).mode & 0o7777, 0o600);
  assert.equal((await fs.stat("/dir")).mode & 0o7777, 0o700);
  assert.equal(fs.capabilities.permissions, false);
  await assert.rejects(fs.writeFile("/invalid", bytes("value"), { mode: -1 }), errno("EINVAL"));
  await assert.rejects(fs.writeFile("/file", bytes("value"), { flag: "invalid" as "w" }), errno("EINVAL"));
});

test("read accepts SDK-style binary streams and byte-array transforms but rejects corrupt bodies", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  await seed(client, "file", "1234");
  const stream = new S3FileSystem({ bucket: "bucket", transport: {
    ...createS3Transport(client), async getObject() {
      return { ContentLength: 4, Body: (async function* () { yield new Uint8Array([0, 255]); yield new Uint8Array([128, 10]); })() };
    },
  } });
  assert.deepEqual(await stream.readFile("/file"), new Uint8Array([0, 255, 128, 10]));
  const converted = new S3FileSystem({ bucket: "bucket", transport: {
    ...createS3Transport(client), async getObject() { return { ContentLength: 4, Body: { async transformToByteArray() { return bytes("1234"); } } }; },
  } });
  assert.equal(text(await converted.readFile("/file")), "1234");
  for (const output of [{}, { ContentLength: 4, Body: bytes("bad") }, { Body: "text is not binary" }]) {
    const broken = new S3FileSystem({ bucket: "bucket", transport: {
      ...createS3Transport(client), async getObject() { return output as never; },
    } });
    await assert.rejects(broken.readFile("/file"), errno("EIO"));
  }
});

test("stream limits stop consumption and close the iterator", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  await seed(client, "file", "1234");
  let closed = false;
  const fs = new S3FileSystem({ bucket: "bucket", maxReadBytes: 4, transport: {
    ...createS3Transport(client), async getObject() {
      return { Body: (async function* () {
        try { yield bytes("1234"); yield bytes("5"); throw new Error("must not consume further"); }
        finally { closed = true; }
      })() };
    },
  } });
  await assert.rejects(fs.readFile("/file"), errno("EFBIG"));
  assert.equal(closed, true);
});

test("oversized GET response closes the SDK-style body when HEAD became stale", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  await seed(client, "file", "1");
  const body = Readable.from([bytes("12345678")]);
  const fs = new S3FileSystem({ bucket: "bucket", maxReadBytes: 4, transport: {
    ...createS3Transport(client), async getObject() { return { Body: body, ContentLength: 8 }; },
  } });
  await assert.rejects(fs.readFile("/file"), errno("EFBIG"));
  assert.equal(body.destroyed, true);
});

test("unsupported POSIX capabilities never report successful emulation", async () => {
  const { fs } = fixture();
  for (const action of [
    () => fs.chmod("/file", 0o600), () => fs.symlink("/file", "/link"),
    () => fs.link("/file", "/link"), () => fs.readlink("/link"),
  ]) await assert.rejects(action(), errno("ENOTSUP"));
  assert.ok(fs.readStream);
  await assert.rejects(fs.readStream("/file")[Symbol.asyncIterator]().next(), errno("ENOENT"));
  await fs.writeFile("/file", bytes("data"));
  await fs.access("/file");
  await fs.access("/file", 4);
  await fs.access("/file", 2);
  await assert.rejects(fs.access("/file", 1), errno("EACCES"));
  await assert.rejects(fs.access("/file", 8), errno("EINVAL"));
});

test("source changes before server-side copy are not copied or deleted", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const transport: S3Transport = {
    ...createS3Transport(client, client.capabilities),
    async copyObject(input, options) {
      await client.putObject({ Bucket: input.Bucket, Key: "source", Body: bytes("changed before copy") });
      return client.copyObject(input, options);
    },
  };
  const fs = new S3FileSystem({ transport, bucket: "bucket", allowNonAtomicRename: true });
  await fs.writeFile("/source", bytes("original"));
  await assert.rejects(fs.rename("/source", "/target"), (error: unknown) => {
    assert.ok(error instanceof S3RenameError);
    assert.equal(error.phase, "copy");
    assert.equal(error.code, "EAGAIN");
    assert.deepEqual(error.copiedKeys, []);
    return true;
  });
  assert.equal(text(await fs.readFile("/source")), "changed before copy");
  assert.equal(client.requests.some((request) => request.operation === "deleteObject"), false);
});

test("missing source ETags and multipart sizes fail copy/rename before mutation", async () => {
  for (const variant of ["etag", "size"] as const) {
    const client = new MockS3Client({ buckets: ["bucket"] });
    await seed(client, "source", "original");
    const transport: S3Transport = {
      ...createS3Transport(client, client.capabilities),
      async headObject(input, options) {
        const head = await client.headObject(input, options);
        return variant === "etag" ? { ...head, ETag: undefined } : { ...head, ContentLength: 5_000_000_001 };
      },
    };
    const fs = new S3FileSystem({ transport, bucket: "bucket", allowNonAtomicRename: true });
    await assert.rejects(fs.copyFile("/source", "/target"), errno("ENOTSUP"));
    await assert.rejects(fs.rename("/source", "/target"), errno("ENOTSUP"));
    assert.equal(client.requests.some((request) => request.operation === "copyObject" || request.operation === "deleteObject"), false);
  }
});

test("mounted-prefix policy covers every operation including copy source and root probes", async () => {
  const { fs, client } = fixture({ allowNonAtomicRename: true }, { authorize(request) {
    const input = request.input;
    if (input.Bucket !== "bucket") throw new S3ServiceError("AccessDenied", 403);
    if ("Key" in input && !input.Key.startsWith("mount/")) throw new S3ServiceError("AccessDenied", 403);
    if ("Prefix" in input && !input.Prefix?.startsWith("mount/")) throw new S3ServiceError("AccessDenied", 403);
    if ("CopySource" in input && !decodeURIComponent(input.CopySource).startsWith("bucket/mount/")) throw new S3ServiceError("AccessDenied", 403);
  } });
  await fs.mkdir("/nested");
  await fs.writeFile("/nested/file", bytes("safe"));
  await fs.copyFile("/nested/file", "/copy");
  await fs.rename("/copy", "/renamed");
  await fs.rm("/nested", { recursive: true });
  assert.equal(text(await fs.readFile("/renamed")), "safe");
  await assert.rejects(client.putObject({ Bucket: "bucket", Key: "outside", Body: bytes("forbidden") }), { name: "AccessDenied" });
});

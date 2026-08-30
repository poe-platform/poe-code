import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FsError, MemoryFileSystem, MountFileSystem, S3FileSystem, S3ServiceError, Shell, standardCommands,
  type FileSystem, type FsOptions, type S3FileSystemOptions, type S3HeadOutput, type S3RequestOptions, type S3Transport,
} from "virtual-bash";

const payload = new Uint8Array([0, 255, 128, 10, 65]);
const previous = new Uint8Array([7, 0, 8]);

async function application() {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/objects/nested", { recursive: true });
  await backing.writeFile("/objects/nested/source", payload);
  await backing.writeFile("/objects/nested/target", previous);
  await backing.writeFile("/objects/nested/keep", previous);
  const versions = new Map([["nested/source", 1], ["nested/target", 1], ["nested/keep", 1]]);
  const requests: string[] = [];
  const optionsFor = (options?: S3RequestOptions): FsOptions => options?.abortSignal ? { signal: options.abortSignal } : {};
  const actualPath = (key: string) => `/objects/${key}`;
  const head = async (key: string, options?: S3RequestOptions): Promise<S3HeadOutput> => {
    options?.abortSignal?.throwIfAborted();
    if (!versions.has(key)) throw new S3ServiceError("NoSuchKey", 404);
    const stat = await backing.stat(actualPath(key), optionsFor(options));
    const decoded = JSON.parse(JSON.stringify({ ContentLength: stat.size, LastModified: new Date(stat.mtimeMs), ETag: `"v${versions.get(key)}"` })) as {
      ContentLength: number; LastModified: string; ETag: string;
    };
    return { ...decoded, LastModified: new Date(decoded.LastModified) };
  };
  const transport: S3Transport = {
    capabilities: { conditionalPut: true, conditionalDelete: true },
    async headObject(input, options) { requests.push("HEAD"); return head(input.Key, options); },
    async getObject(input, options) {
      requests.push("GET");
      return { ...await head(input.Key, options), Body: await backing.readFile(actualPath(input.Key), optionsFor(options)) };
    },
    async putObject(input, options) {
      requests.push("PUT");
      options?.abortSignal?.throwIfAborted();
      if (input.IfMatch !== undefined && input.IfMatch !== `"v${versions.get(input.Key)}"`) throw new S3ServiceError("PreconditionFailed", 412);
      if (input.IfNoneMatch === "*" && versions.has(input.Key)) throw new S3ServiceError("PreconditionFailed", 412);
      await backing.writeFile(actualPath(input.Key), input.Body, { ...optionsFor(options), flag: input.IfNoneMatch === "*" ? "wx" : "w" });
      versions.set(input.Key, (versions.get(input.Key) ?? 0) + 1);
      return { ETag: `"v${versions.get(input.Key)}"` };
    },
    async deleteObject(input, options) {
      requests.push("DELETE");
      options?.abortSignal?.throwIfAborted();
      if (input.IfMatch !== undefined && input.IfMatch !== `"v${versions.get(input.Key)}"`) throw new S3ServiceError("PreconditionFailed", 412);
      await backing.rm(actualPath(input.Key), optionsFor(options));
      versions.delete(input.Key);
      return {};
    },
    async copyObject() { throw new S3ServiceError("NotImplemented", 501); },
    async listObjectsV2(input, options) {
      requests.push("LIST");
      options?.abortSignal?.throwIfAborted();
      const prefix = input.Prefix ?? "";
      const objects = new Set<string>();
      const directories = new Set<string>();
      for (const key of [...versions.keys()].sort()) {
        if (!key.startsWith(prefix)) continue;
        const delimiter = input.Delimiter ? key.indexOf(input.Delimiter, prefix.length) : -1;
        if (delimiter < 0) objects.add(key);
        else directories.add(key.slice(0, delimiter + input.Delimiter!.length));
      }
      const entries = [...objects].map(key => ({ key, directory: false })).concat([...directories].map(key => ({ key, directory: true })));
      entries.sort((left, right) => left.key.localeCompare(right.key));
      const start = Number(input.ContinuationToken ?? 0);
      const page = entries.slice(start, start + (input.MaxKeys ?? 1000));
      const next = start + page.length;
      return {
        Contents: await Promise.all(page.filter(entry => !entry.directory).map(async entry => ({ Key: entry.key, Size: (await head(entry.key, options)).ContentLength! }))),
        CommonPrefixes: page.filter(entry => entry.directory).map(entry => ({ Prefix: entry.key })),
        IsTruncated: next < entries.length,
        ...(next < entries.length ? { NextContinuationToken: String(next) } : {}),
      };
    },
  };
  const bindings = new WeakMap<FileSystem, string>();
  bindings.set(backing, "/");
  const resolveBacking = async (filesystem: FileSystem, path: string, options: FsOptions) => {
    options.signal?.throwIfAborted();
    const root = bindings.get(filesystem);
    if (root === undefined) return undefined;
    const stat = await backing.stat(root + path.slice(1), options);
    options.signal?.throwIfAborted();
    return stat;
  };
  const comparison: NonNullable<S3FileSystemOptions["compareEntry"]> = async function (path, peer, peerPath, options = {}) {
    const own = await resolveBacking(this, path, options);
    options.signal?.throwIfAborted();
    const other = await resolveBacking(peer, peerPath, options);
    if (!own || !other || own.identityScope === undefined || other.identityScope === undefined
      || own.dev === undefined || other.dev === undefined || own.ino === undefined || other.ino === undefined) return "unknown";
    return own.identityScope === other.identityScope && own.dev === other.dev && own.ino === other.ino ? "same" : "distinct";
  };
  const contractCompatible: NonNullable<FileSystem["compareEntry"]> = comparison;
  const constructorCompatible: NonNullable<S3FileSystemOptions["compareEntry"]> = contractCompatible;
  const make = (prefix: string, authority: boolean) => {
    const filesystem = new S3FileSystem({ bucket: "objects", prefix, transport,
      ...(authority ? { compareEntry: constructorCompatible } : {}) });
    bindings.set(filesystem, `/objects/${prefix ? `${prefix}/` : ""}`);
    return filesystem;
  };
  return { backing, requests, make };
}

for (const command of ["cp", "mv"] as const) for (const authority of [true, false]) {
  test(`public built package: serialized SDK ${command}, authority ${authority}`, async () => {
    const app = await application();
    const first = app.make("", authority);
    const second = app.make("nested", authority);
    const filesystem = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second } });
    const offset = app.requests.length;
    const relation = await filesystem.compareEntry("/first/nested/source", filesystem, "/second/target");
    assert.equal(relation, authority ? "distinct" : "unknown");
    assert.ok(app.requests.slice(offset).every(operation => operation === "HEAD" || operation === "LIST"));
    const result = await new Shell({ fs: filesystem }).use(standardCommands()).exec(`${command} /first/nested/source /second/target`);
    if (authority) assert.equal(result.exitCode, 0, result.stderr);
    else {
      assert.notEqual(result.exitCode, 0);
      assert.ok(app.requests.slice(offset).every(operation => operation === "HEAD" || operation === "LIST"));
      await assert.rejects(filesystem.copyFile("/first/nested/source", "/second/target"), { code: "ENOTSUP" });
    }
    assert.deepEqual(await app.backing.readFile("/objects/nested/target"), authority ? payload : previous);
    assert.deepEqual(await app.backing.readFile("/objects/nested/keep"), previous);
    if (command === "mv" && authority) await assert.rejects(app.backing.stat("/objects/nested/source"), { code: "ENOENT" });
    else assert.deepEqual(await app.backing.readFile("/objects/nested/source"), payload);
  });
}

test("public built package: overlapping SDK views and actual Memory backing remain aliases", async () => {
  const app = await application();
  const first = app.make("", true);
  const second = app.make("nested", true);
  const filesystem = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second, "/actual": app.backing } });
  const offset = app.requests.length;
  assert.equal(await filesystem.compareEntry("/first/nested/source", filesystem, "/second/source"), "same");
  assert.equal(await filesystem.compareEntry("/second/source", filesystem, "/actual/objects/nested/source"), "same");
  await assert.rejects(filesystem.copyFile("/first/nested/source", "/second/source"), { code: "EINVAL" });
  const result = await new Shell({ fs: filesystem }).use(standardCommands()).exec("mv /first/nested/source /second/source");
  assert.notEqual(result.exitCode, 0);
  assert.ok(app.requests.slice(offset).every(operation => operation === "HEAD" || operation === "LIST"));
  assert.deepEqual(await app.backing.readFile("/objects/nested/source"), payload);
});

test("public built package: resolver leaves an unregistered backing relationship unknown", async () => {
  const app = await application();
  const remote = app.make("nested", true);
  const unregistered = new MemoryFileSystem();
  await unregistered.writeFile("/target", previous);
  const filesystem = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": remote, "/second": unregistered } });
  assert.equal(await filesystem.compareEntry("/first/source", filesystem, "/second/target"), "unknown");
  await assert.rejects(filesystem.copyFile("/first/source", "/second/target"), (error: unknown) => error instanceof FsError && error.code === "ENOTSUP");
  assert.deepEqual(await unregistered.readFile("/target"), previous);
  assert.deepEqual(await app.backing.readFile("/objects/nested/source"), payload);
});

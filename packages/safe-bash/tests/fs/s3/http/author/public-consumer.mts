import assert from "node:assert/strict";
import {
  FsError, MemoryFileSystem, MountFileSystem, Shell, isFsError, normalizePath, standardCommands,
  createS3HttpTransport as rootCreateS3HttpTransport,
  type FileSystem, type FsOptions,
} from "virtual-bash";
import {
  S3FileSystem, type S3FileSystemOptions,
} from "virtual-bash/fs/s3";
import { createS3HttpTransport, type S3HttpCredentials } from "virtual-bash/fs/s3/http";

assert.equal(rootCreateS3HttpTransport, createS3HttpTransport, "root and HTTP subpath export the same factory");

export interface PublicS3ExampleOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly credentials: S3HttpCredentials;
  readonly bucket: string;
  readonly prefix: string;
  readonly verifiedConditionalPut: true;
  readonly allowInsecureHttp?: boolean;
  readonly listUrlEncoding?: "percent" | "form";
  readonly signal?: AbortSignal;
}

export interface PublicS3ExampleResult {
  readonly bucket: string;
  readonly prefix: string;
  readonly checks: readonly string[];
  readonly sourceBytes: readonly number[];
  readonly copiedBytes: readonly number[];
  readonly workEntries: readonly string[];
  readonly nativeConditionalCopy: false;
  readonly effectiveConditionalCopy: true;
  readonly conditionalDelete: false;
  readonly atomicRename: false;
  readonly move: {
    readonly supported: false;
    readonly code: "ENOTSUP";
    readonly sourcePreserved: true;
    readonly targetPreserved: true;
  };
}

interface ViewBinding {
  readonly bucket: string;
  readonly prefix: string;
}

export async function runPublicS3Example(options: PublicS3ExampleOptions): Promise<PublicS3ExampleResult> {
  if (options.verifiedConditionalPut !== true) throw new FsError("EINVAL", { message: "this example requires independently verified conditional PUT" });
  if (typeof options.prefix !== "string" || !options.prefix || options.prefix.startsWith("/")
    || options.prefix.endsWith("/") || options.prefix.includes("\0")
    || options.prefix.split("/").some(part => !part || part === "." || part === "..")) {
    throw new FsError("EINVAL", { message: "supply a fresh canonical relative prefix without a trailing slash" });
  }
  const namespacePrefix = `${options.prefix}/`;
  const operationOptions: FsOptions = options.signal ? { signal: options.signal } : {};
  const requestOptions = options.signal ? { abortSignal: options.signal } : {};
  const transport = createS3HttpTransport({ endpoint: options.endpoint, region: options.region,
    credentials: options.credentials, enableCopy: false,
    verifiedConditionalOperations: { put: true, copy: false, delete: false },
    ...(options.allowInsecureHttp === undefined ? {} : { allowInsecureHttp: options.allowInsecureHttp }),
    ...(options.listUrlEncoding === undefined ? {} : { listUrlEncoding: options.listUrlEncoding }),
  });
  const initial = await transport.listObjectsV2({ Bucket: options.bucket, Prefix: namespacePrefix, MaxKeys: 1 }, requestOptions);
  if ((initial.Contents?.length ?? 0) || (initial.CommonPrefixes?.length ?? 0) || initial.IsTruncated) {
    throw new FsError("EEXIST", { message: "example prefix is not empty; use a new isolated prefix" });
  }

  const bindings = new WeakMap<FileSystem, ViewBinding>();
  const comparison: NonNullable<S3FileSystemOptions["compareEntry"]> = async function (path, peer, peerPath, fsOptions = {}) {
    fsOptions.signal?.throwIfAborted();
    const local = bindings.get(this);
    const remote = bindings.get(peer);
    if (!local || !remote || local.bucket !== options.bucket || remote.bucket !== options.bucket) return "unknown";
    const ownStat = await this.stat(path, fsOptions);
    fsOptions.signal?.throwIfAborted();
    const peerStat = await peer.stat(peerPath, fsOptions);
    fsOptions.signal?.throwIfAborted();
    if (ownStat.type !== "file" || peerStat.type !== "file") return "unknown";
    const localKey = local.prefix + normalizePath(path).slice(1);
    const remoteKey = remote.prefix + normalizePath(peerPath).slice(1);
    return localKey === remoteKey ? "same" : "distinct";
  };
  const contractCompatible: NonNullable<FileSystem["compareEntry"]> = comparison;
  const makeView = (prefix: string): S3FileSystem => {
    const filesystem = new S3FileSystem({ transport, bucket: options.bucket, prefix,
      compareEntry: contractCompatible, allowNonAtomicRename: true });
    bindings.set(filesystem, Object.freeze({ bucket: options.bucket, prefix }));
    return filesystem;
  };
  const primary = makeView(namespacePrefix);
  const overlap = makeView(`${namespacePrefix}work/`);
  const other = makeView(`${namespacePrefix}other/`);
  const unregistered = new S3FileSystem({ transport, bucket: options.bucket, prefix: namespacePrefix });
  const memory = new MemoryFileSystem();
  const mounted = new MountFileSystem({ root: memory, mounts: { "/remote": primary, "/overlap": overlap, "/other": other } });
  const shell = new Shell({ fs: mounted }).use(standardCommands());
  const checks: string[] = [];
  const check = async (name: string, action: () => Promise<void>): Promise<void> => { await action(); checks.push(name); };
  const source = new Uint8Array([0, 255, 128, 10, 65]);
  const replacement = new Uint8Array([66, 0, 67, 255]);
  const previous = new Uint8Array([7, 8, 9]);
  const equalBytes = async (filesystem: FileSystem, path: string, expected: Uint8Array): Promise<void> => {
    assert.deepEqual([...await filesystem.readFile(path, operationOptions)], [...expected]);
  };

  await check("create directories and exclusive binary source", async () => {
    await primary.mkdir("/work", operationOptions);
    await primary.mkdir("/other", operationOptions);
    await primary.writeFile("/work/source", source, { ...operationOptions, flag: "wx" });
    await equalBytes(primary, "/work/source", source);
    await assert.rejects(primary.writeFile("/work/source", previous, { ...operationOptions, flag: "wx" }), error => isFsError(error, "EEXIST"));
    await equalBytes(primary, "/work/source", source);
  });
  await check("list exact UTF-8, space, plus and percent filename", async () => {
    await primary.writeFile("/work/雪 space +%", source, { ...operationOptions, flag: "wx" });
    const entries = await primary.readdir("/work", operationOptions);
    assert.deepEqual(entries.map(entry => entry.name).sort(), ["source", "雪 space +%"].sort());
    await equalBytes(primary, "/work/雪 space +%", source);
  });
  await check("mounted same-view copy to missing and existing targets", async () => {
    await primary.writeFile("/work/existing", previous, { ...operationOptions, flag: "wx" });
    for (const target of ["copy", "existing"]) {
      const result = await shell.exec(`cp /remote/work/source /remote/work/${target}`, operationOptions);
      assert.equal(result.exitCode, 0, result.stderr);
      await equalBytes(primary, `/work/${target}`, source);
    }
    await equalBytes(primary, "/work/source", source);
  });
  await check("overwrite, read back and preserve earlier copied snapshot", async () => {
    await primary.writeFile("/work/source", replacement, operationOptions);
    await equalBytes(primary, "/work/source", replacement);
    await equalBytes(primary, "/work/copy", source);
  });
  await check("fresh application resolver recognizes distinct registered prefix views", async () => {
    await other.writeFile("/target", previous, { ...operationOptions, flag: "wx" });
    assert.equal(await primary.compareEntry("/work/source", other, "/target", operationOptions), "distinct");
    const result = await shell.exec("cp /remote/work/source /other/target", operationOptions);
    assert.equal(result.exitCode, 0, result.stderr);
    await equalBytes(other, "/target", replacement);
    await equalBytes(primary, "/work/source", replacement);
  });
  await check("overlapping bucket/prefix mappings identify same-key alias and protect bytes", async () => {
    assert.equal(await primary.compareEntry("/work/source", overlap, "/source", operationOptions), "same");
    const result = await shell.exec("cp /remote/work/source /overlap/source", operationOptions);
    assert.notEqual(result.exitCode, 0);
    await equalBytes(primary, "/work/source", replacement);
    await equalBytes(overlap, "/source", replacement);
  });
  await check("unregistered and cross-provider views remain unknown", async () => {
    await memory.writeFile("/local", previous, operationOptions);
    assert.equal(await primary.compareEntry("/work/source", unregistered, "/work/existing", operationOptions), "unknown");
    assert.equal(await primary.compareEntry("/work/source", memory, "/local", operationOptions), "unknown");
    const result = await shell.exec("cp /remote/work/source /local", operationOptions);
    assert.notEqual(result.exitCode, 0);
    await equalBytes(memory, "/local", previous);
    await equalBytes(primary, "/work/source", replacement);
  });
  await check("fresh missing metadata and caller cancellation propagate", async () => {
    await assert.rejects(primary.compareEntry("/work/missing", overlap, "/source", operationOptions), error => isFsError(error, "ENOENT"));
    const controller = new AbortController();
    const reason = new FsError("EACCES", { message: "explicit example cancellation" });
    controller.abort(reason);
    await assert.rejects(primary.compareEntry("/work/source", overlap, "/source", { signal: controller.signal }), error => error === reason);
    await equalBytes(primary, "/work/source", replacement);
  });
  await check("unsupported guarded move reports ENOTSUP and preserves both names and bytes", async () => {
    await primary.writeFile("/work/move-target", previous, { ...operationOptions, flag: "wx" });
    assert.equal(transport.capabilities?.conditionalDelete, false);
    assert.equal(primary.capabilities.atomicRename, false);
    await assert.rejects(primary.rename("/work/source", "/work/move-target", operationOptions), error => isFsError(error, "ENOTSUP"));
    const result = await shell.exec("mv /remote/work/source /remote/work/move-target", operationOptions);
    assert.notEqual(result.exitCode, 0);
    await equalBytes(primary, "/work/source", replacement);
    await equalBytes(primary, "/work/move-target", previous);
  });
  assert.equal(transport.capabilities?.conditionalCopy, true);
  options.signal?.throwIfAborted();
  const workEntries = (await primary.readdir("/work", operationOptions)).map(entry => entry.name).sort();
  assert.deepEqual(workEntries, ["source", "copy", "existing", "move-target", "雪 space +%"].sort());
  return { bucket: options.bucket, prefix: options.prefix, checks, sourceBytes: [...replacement], copiedBytes: [...source], workEntries,
    nativeConditionalCopy: false, effectiveConditionalCopy: true, conditionalDelete: false, atomicRename: false,
    move: { supported: false, code: "ENOTSUP", sourcePreserved: true, targetPreserved: true } };
}

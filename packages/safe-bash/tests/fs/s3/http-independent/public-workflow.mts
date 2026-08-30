import assert from "node:assert/strict";
import { Shell, ShellLimitError, MemoryFileSystem, MountFileSystem, S3FileSystem, agentCommands, isFsError, normalizePath, type FileSystem } from "virtual-bash";
import { createS3HttpTransport, type S3HttpCredentials, type S3HttpRequestFactory } from "virtual-bash/fs/s3/http";

export async function runIndependentWorkflow(options: {
  endpoint: string; bucket: string; prefix: string; credentials: S3HttpCredentials; request: S3HttpRequestFactory;
  oracle: (key: string) => Promise<{ status: number; bytes: Uint8Array }>;
}) {
  const checks: { name: string; kind: string; passed: boolean; error?: string }[] = [];
  const witnesses: { key: string; status: number; bytes: string }[] = [];
  const bytes = Buffer.from(Array.from({ length: 513 }, (_unused, index) => index & 255));
  const replacement = Buffer.from([255, 0, 1, 128, 13, 10]), previous = Buffer.from("previous");
  const transport = createS3HttpTransport({ endpoint: options.endpoint, region: "us-east-1", credentials: options.credentials,
    request: options.request, allowInsecureHttp: true, enableCopy: false, listUrlEncoding: "form",
    verifiedConditionalOperations: { put: true, copy: false, delete: false }, requestTimeoutMs: 5000 });
  const bindings = new Map<FileSystem, string>();
  const compare: NonNullable<FileSystem["compareEntry"]> = async function(this: FileSystem, path, peer, peerPath, requestOptions = {}) {
    requestOptions.signal?.throwIfAborted();
    const ownPrefix = bindings.get(this), peerPrefix = bindings.get(peer);
    if (ownPrefix === undefined || peerPrefix === undefined) return "unknown";
    const own = await this.stat(path, requestOptions), other = await peer.stat(peerPath, requestOptions);
    requestOptions.signal?.throwIfAborted();
    if (own.type !== "file" || other.type !== "file") return "unknown";
    return ownPrefix + normalizePath(path).slice(1) === peerPrefix + normalizePath(peerPath).slice(1) ? "same" : "distinct";
  };
  const make = (prefix: string) => {
    const filesystem = new S3FileSystem({ transport, bucket: options.bucket, prefix, compareEntry: compare, pageSize: 2, allowNonAtomicRename: true });
    bindings.set(filesystem, prefix); return filesystem;
  };
  const remote = make(options.prefix + "/"), alias = make(options.prefix + "/data/");
  const memory = new MemoryFileSystem(); await memory.mkdir("/local");
  const mounted = new MountFileSystem({ root: memory, mounts: { "/remote": remote, "/alias": alias } });
  const shell = new Shell({ fs: mounted }).use(agentCommands());
  const check = async (name: string, kind: string, action: () => Promise<void>) => {
    try { await action(); checks.push({ name, kind, passed: true }); }
    catch (error) { checks.push({ name, kind, passed: false, error: error instanceof Error ? error.stack ?? error.message : String(error) }); }
  };
  const native = async (path: string, expected: Uint8Array | undefined) => {
    const key = options.prefix + path;
    const result = await options.oracle(key);
    witnesses.push({ key, status: result.status, bytes: Buffer.from(result.bytes).toString("base64") });
    assert.equal(result.status, expected === undefined ? 404 : 200);
    if (expected !== undefined) assert.deepEqual(Buffer.from(result.bytes), Buffer.from(expected));
  };
  const file = async (path: string, expected: Uint8Array) => { assert.deepEqual(Buffer.from(await remote.readFile(path)), Buffer.from(expected)); await native(path, expected); };
  try {
    await check("truthful effective capabilities", "mechanical", async () => {
      assert.equal(transport.capabilities?.conditionalPut, true); assert.equal(transport.capabilities?.conditionalCopy, true);
      assert.equal(transport.capabilities?.conditionalDelete, false); assert.equal(transport.capabilities?.streamingWrite, false);
      assert.equal(transport.putObjectStream, undefined); assert.equal(remote.capabilities.atomicRename, false);
    });
    await check("create directory and exclusive binary file; read exact service bytes", "workflow", async () => {
      await remote.mkdir("/data"); await remote.writeFile("/data/source", bytes, { flag: "wx" });
      await file("/data/source", bytes); await native("/data/", Buffer.alloc(0));
    });
    await check("exclusive collision preserves the old object", "guard", async () => {
      await assert.rejects(remote.writeFile("/data/source", previous, { flag: "wx" }), error => isFsError(error, "EEXIST")); await file("/data/source", bytes);
    });
    await check("pageSize2 listing preserves Unicode, plus, percent and spaces", "workflow", async () => {
      for (const name of ["alpha", "space +%.txt", "雪"]) await remote.writeFile(`/data/${name}`, bytes);
      assert.deepEqual((await remote.readdir("/data")).map(entry => entry.name).sort(), ["source", "alpha", "space +%.txt", "雪"].sort());
      await file("/data/space +%.txt", bytes); await file("/data/雪", bytes);
    });
    await check("actual shell binary pipeline writes through mounted HTTP FS", "workflow", async () => {
      const result = await shell.exec("cat /remote/data/source | base64 | base64 -d > /remote/data/roundtrip");
      assert.equal(result.exitCode, 0, result.stderr); await file("/data/roundtrip", bytes);
    });
    await check("actual shell cp to a missing object", "workflow", async () => {
      const result = await shell.exec("cp /remote/data/source /remote/data/copied"); assert.equal(result.exitCode, 0, result.stderr); await file("/data/copied", bytes);
    });
    await check("actual shell cp overwrites a known distinct existing object", "workflow", async () => {
      await remote.writeFile("/data/existing", previous);
      const result = await shell.exec("cp /remote/data/source /remote/data/existing"); assert.equal(result.exitCode, 0, result.stderr); await file("/data/existing", bytes); await file("/data/source", bytes);
    });
    await check("overwrite changes source while earlier copy remains a snapshot", "workflow", async () => {
      await remote.writeFile("/data/source", replacement); await file("/data/source", replacement); await file("/data/copied", bytes);
    });
    await check("exclusive direct copy refuses an existing destination", "guard", async () => {
      await assert.rejects(remote.copyFile("/data/source", "/data/copied", { exclusive: true }), error => isFsError(error, "EEXIST")); await file("/data/copied", bytes);
    });
    await check("application key mapping protects an overlapping mount alias", "guard", async () => {
      const result = await shell.exec("cp /remote/data/source /alias/source"); assert.notEqual(result.exitCode, 0); await file("/data/source", replacement);
    });
    await check("HTTP source streams through shell into an independent memory mount", "workflow", async () => {
      const result = await shell.exec("cat /remote/data/source > /local/captured"); assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(Buffer.from(await memory.readFile("/local/captured")), replacement); await file("/data/source", replacement);
    });
    await check("ordinary command deletion removes the actual object", "workflow", async () => {
      const result = await shell.exec("rm /remote/data/roundtrip"); assert.equal(result.exitCode, 0, result.stderr); await native("/data/roundtrip", undefined);
      await assert.rejects(remote.stat("/data/roundtrip"), error => isFsError(error, "ENOENT"));
    });
    await check("declared guarded rename refusal preserves both names and bytes", "refusal", async () => {
      await remote.writeFile("/data/move-target", previous);
      await assert.rejects(remote.rename("/data/source", "/data/move-target"), error => isFsError(error, "ENOTSUP"));
      const result = await shell.exec("mv /remote/data/source /remote/data/move-target"); assert.notEqual(result.exitCode, 0);
      await file("/data/source", replacement); await file("/data/move-target", previous);
    });
    await check("safe rmdir remains an explicit backend refusal", "refusal", async () => {
      await remote.mkdir("/empty"); await assert.rejects(remote.rmdir("/empty"), error => isFsError(error, "ENOTSUP")); await native("/empty/", Buffer.alloc(0));
    });
    await check("caller pre-abort does not publish new object bytes", "guard", async () => {
      const controller = new AbortController(), reason = new Error("independent cancellation"); controller.abort(reason);
      await assert.rejects(remote.writeFile("/data/source", previous, { signal: controller.signal }), error => isFsError(error, "ECANCELED")); await file("/data/source", replacement);
    });
    await check("actual shell output budget remains active through HTTP reads", "guard", async () => {
      await assert.rejects(shell.exec("cat /remote/data/source", { limits: { maxOutputBytes: 3 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes"); await file("/data/source", replacement);
    });
  } finally { await shell.dispose(); }
  return { checks, witnesses, total: checks.length, passed: checks.filter(check => check.passed).length,
    workflows: checks.filter(check => check.kind === "workflow").length, guardedMove: false, safeRmdir: false,
    authority: "Application-owned mappings for this fresh MinIO bucket/prefix only; no mock/private identity, generic endpoint or ETag disjointness inference." };
}

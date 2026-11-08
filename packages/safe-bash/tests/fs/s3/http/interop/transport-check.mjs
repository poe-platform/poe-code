import assert from "node:assert/strict";
import { request as nativeRequest } from "node:http";
import { join } from "node:path";
import { createMemoryFileSystem, createMountFileSystem, FsError, S3FileSystem, Shell, standardCommands } from "virtual-bash";
import { createS3HttpTransport } from "../../../../../dist/fs/s3/http/index.js";
import { save, withService } from "./service.mjs";

const bytes = Buffer.from([0, 255, 128, 65, 13, 10]);
const previous = Buffer.from([79, 76, 68]);
const changed = Buffer.from([78, 69, 87]);
const code = (status, name) => error => { assert.equal(error?.$metadata?.httpStatusCode, status); if (name) assert.equal(error.code, name); return true; };
const fsCode = expected => error => { assert.ok(error instanceof FsError); assert.equal(error.code, expected); return true; };

await withService(process.argv[2], async ({ output, endpoint, credentials, bucket, wire }) => {
  const trace = [], results = [];
  const request = (options, callback) => {
    assert.equal(options.hostname, "127.0.0.1");
    assert.equal(String(options.port), new URL(endpoint).port);
    const entry = { method: options.method, path: options.path, headers: options.headers };
    trace.push(entry);
    return nativeRequest(options, response => { entry.status = response.statusCode; entry.responseHeaders = response.headers; callback(response); });
  };
  const options = { endpoint, region: "us-east-1", credentials, request, allowInsecureHttp: true, listUrlEncoding: "form",
    verifiedConditionalOperations: { put: true, copy: false, delete: false } };
  const transport = createS3HttpTransport(options);
  const fallback = createS3HttpTransport({ ...options, enableCopy: false });
  const input = Key => ({ Bucket: bucket, Key });
  const put = (key, body, extra = {}) => transport.putObject({ ...input(key), Body: body, ...extra });
  const read = async key => Buffer.from((await transport.getObject(input(key))).Body);
  const test = async (name, run) => {
    const start = trace.length;
    try { await run(); results.push({ name, passed: true, firstRequest: start, endRequest: trace.length }); }
    catch (error) { results.push({ name, passed: false, firstRequest: start, endRequest: trace.length,
      error: { name: error.name, message: error.message, stack: error.stack, code: error.code } }); }
    save(join(output, "transport-results.json"), results);
    save(join(output, "transport-wire.json"), trace);
  };
  await test("actual SigV4 binary PUT HEAD GET and user metadata", async () => {
    await put("binary", bytes, { Metadata: { fixture: "synthetic" } });
    const head = await transport.headObject(input("binary"));
    assert.equal(head.ContentLength, bytes.length);
    assert.ok(head.LastModified instanceof Date);
    assert.ok(head.ETag);
    assert.equal(head.Metadata.fixture, "synthetic");
    assert.deepEqual(await read("binary"), bytes);
  });
  await test("Unicode spaces percent plus and ampersand keys round trip", async () => {
    const key = "encoded/café +%&.bin";
    await put(key, bytes);
    assert.deepEqual(await read(key), bytes);
    const raw = await wire("GET", `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
    assert.equal(raw.status, 200); assert.deepEqual(raw.body, bytes);
  });
  await test("wrong credentials reject before publication and HEAD missing stays 404", async () => {
    await put("denied", previous);
    const denied = createS3HttpTransport({ ...options, credentials: { ...credentials, secretAccessKey: "wrong-synthetic-secret" } });
    await assert.rejects(denied.putObject({ ...input("denied"), Body: changed }), code(403, "SignatureDoesNotMatch"));
    await assert.rejects(transport.headObject(input("missing-head")), code(404));
    assert.deepEqual(await read("denied"), previous);
  });
  await test("conditional PUT positive stale missing and exclusive guards preserve exact bytes", async () => {
    await put("conditional", previous);
    const head = await transport.headObject(input("conditional"));
    await assert.rejects(put("conditional", changed, { IfMatch: '"stale"' }), code(412, "PreconditionFailed"));
    assert.deepEqual(await read("conditional"), previous);
    await put("conditional", changed, { IfMatch: head.ETag });
    assert.deepEqual(await read("conditional"), changed);
    await assert.rejects(put("conditional-missing", changed, { IfMatch: head.ETag }), code(404, "NoSuchKey"));
    await assert.rejects(transport.headObject(input("conditional-missing")), code(404));
    await assert.rejects(put("conditional", bytes, { IfNoneMatch: "*" }), code(412, "PreconditionFailed"));
    assert.deepEqual(await read("conditional"), changed);
    await put("conditional-new", bytes, { IfNoneMatch: "*" });
    assert.deepEqual(await read("conditional-new"), bytes);
  });
  await test("ordinary server COPY accepts already encoded source and preserves source", async () => {
    await put("copy source+%", bytes);
    const copied = await transport.copyObject({ ...input("copy-target"), CopySource: `${bucket}/copy%20source%2B%25` });
    assert.ok(copied.CopyObjectResult.ETag);
    assert.deepEqual(await read("copy-target"), bytes);
    assert.deepEqual(await read("copy source+%"), bytes);
  });
  await test("unsupported conditional COPY DELETE and default conditional PUT fail before requests", async () => {
    const start = trace.length;
    await assert.rejects(transport.copyObject({ ...input("blocked-copy"), CopySource: `${bucket}/binary`, IfNoneMatch: "*" }), code(501, "NotImplemented"));
    await assert.rejects(transport.deleteObject({ ...input("binary"), IfMatch: '"stale"' }), code(501, "NotImplemented"));
    const unverified = createS3HttpTransport({ ...options, verifiedConditionalOperations: undefined });
    await assert.rejects(unverified.putObject({ ...input("blocked-put"), Body: bytes, IfNoneMatch: "*" }), code(501, "NotImplemented"));
    assert.equal(trace.length, start);
    assert.deepEqual(await read("binary"), bytes);
  });
  await test("ordinary DELETE removes only its selected object", async () => {
    await put("delete-one", bytes); await put("delete-neighbor", previous);
    await transport.deleteObject(input("delete-one"));
    await assert.rejects(transport.headObject(input("delete-one")), code(404));
    assert.deepEqual(await read("delete-neighbor"), previous);
  });
  await test("ListObjectsV2 pagination opaque continuation and delimiter preserve names", async () => {
    const keys = ["pages/a", "pages/space +%", "pages/z", "pages/sub/child"];
    for (const key of keys) await put(key, bytes);
    const seen = []; let token;
    for (let page = 0; page < 10; page++) {
      const result = await transport.listObjectsV2({ Bucket: bucket, Prefix: "pages/", MaxKeys: 1, ...(token ? { ContinuationToken: token } : {}) });
      assert.ok(result.Contents.length <= 1);
      seen.push(...result.Contents.map(entry => entry.Key));
      if (!result.IsTruncated) break;
      assert.ok(result.NextContinuationToken && result.NextContinuationToken !== token);
      token = result.NextContinuationToken;
    }
    const raw = await wire("GET", `/${bucket}?list-type=2&encoding-type=url&prefix=pages%2F`);
    assert.equal(raw.status, 200);
    save(join(output, "list-wire-observation.json"), { expected: keys, actual: seen, xml: raw.bodyText, source: "independently signed curl request" });
    assert.deepEqual(seen.sort(), keys.sort());
    const grouped = await transport.listObjectsV2({ Bucket: bucket, Prefix: "pages/", Delimiter: "/" });
    assert.deepEqual(grouped.CommonPrefixes, [{ Prefix: "pages/sub/" }]);
  });
  await test("streamed GET range IfMatch and pre-abort retain typed errors and bytes", async () => {
    await put("stream", bytes);
    const head = await transport.headObject(input("stream"));
    const stream = await transport.getObjectStream({ ...input("stream"), Range: "bytes=1-3", IfMatch: head.ETag });
    const chunks = []; for await (const chunk of stream.Body) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), bytes.subarray(1, 4));
    await assert.rejects(transport.getObjectStream({ ...input("stream"), IfMatch: '"stale"' }), code(412, "PreconditionFailed"));
    const reason = new Error("synthetic abort"); const start = trace.length;
    await assert.rejects(transport.getObject(input("stream"), { abortSignal: AbortSignal.abort(reason) }), error => error === reason);
    assert.equal(trace.length, start);
  });

  const memory = createMemoryFileSystem();
  const prefixes = new Map();
  const binding = async function(path, peer, peerPath, settings = {}) {
    settings.signal?.throwIfAborted();
    const ownPrefix = prefixes.get(this);
    if (ownPrefix === undefined) return "unknown";
    if (peer === memory) return "distinct";
    const peerPrefix = prefixes.get(peer);
    if (peerPrefix === undefined) return "unknown";
    return ownPrefix + path === peerPrefix + peerPath ? "same" : "distinct";
  };
  const remote = new S3FileSystem({ transport: fallback, bucket, prefix: "vfs", compareEntry: binding, pageSize: 1 });
  const alias = new S3FileSystem({ transport: fallback, bucket, prefix: "vfs", compareEntry: binding });
  prefixes.set(remote, "vfs"); prefixes.set(alias, "vfs");
  const mounted = createMountFileSystem({ root: memory, mounts: { "/remote": remote, "/alias": alias } });
  const shell = new Shell({ fs: mounted }).use(standardCommands());
  await test("actual Shell existing-target Memory to MinIO copy with truthful host binding", async () => {
    await memory.writeFile("/local-source", bytes); await put("vfs/target", previous);
    const start = trace.length;
    const result = await shell.exec("cp /local-source /remote/target");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, ""); assert.equal(result.stdout, "");
    assert.deepEqual(Buffer.from(await remote.readFile("/target")), bytes);
    assert.deepEqual(Buffer.from(await memory.readFile("/local-source")), bytes);
    assert.ok(trace.slice(start).some(entry => entry.method === "PUT"));
    assert.ok(trace.slice(start).every(entry => !entry.headers["x-amz-copy-source"] && entry.method !== "DELETE"));
  });
  await test("actual Shell existing-target MinIO to Memory copy", async () => {
    await put("vfs/source", bytes); await memory.writeFile("/local-target", previous);
    const result = await shell.exec("cp /remote/source /local-target");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
    assert.deepEqual(Buffer.from(await memory.readFile("/local-target")), bytes);
    assert.deepEqual(Buffer.from(await remote.readFile("/source")), bytes);
  });
  await test("same service same key alias refuses copy without content or mutation", async () => {
    await put("vfs/shared", bytes);
    const start = trace.length;
    assert.equal(await remote.compareEntry("/shared", alias, "/shared"), "same");
    await assert.rejects(mounted.copyFile("/remote/shared", "/alias/shared"), fsCode("EINVAL"));
    assert.ok(trace.slice(start).every(entry => entry.method === "HEAD" || entry.method === "GET" && entry.path.includes("list-type=2")));
    assert.deepEqual(await read("vfs/shared"), bytes);
  });
  await test("same service different key actual mounted copy uses GET PUT not server COPY", async () => {
    await put("vfs/distinct-source", bytes); await put("vfs/distinct-target", previous);
    assert.equal(await remote.compareEntry("/distinct-source", alias, "/distinct-target"), "distinct");
    const start = trace.length;
    const result = await shell.exec("cp /remote/distinct-source /alias/distinct-target");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await read("vfs/distinct-target"), bytes);
    assert.deepEqual(await read("vfs/distinct-source"), bytes);
    assert.ok(trace.slice(start).some(entry => entry.method === "PUT"));
    assert.ok(trace.slice(start).every(entry => !entry.headers["x-amz-copy-source"] && entry.method !== "DELETE"));
  });
  for (const existing of [true, false]) {
    await test(`required ordinary same-view Shell copy to ${existing ? "existing" : "missing"} target with native COPY disabled`, async () => {
      const source = `single-source-${existing}`, target = `single-target-${existing}`;
      await put(`vfs/${source}`, bytes);
      if (existing) await put(`vfs/${target}`, previous);
      const result = await shell.exec(`cp /remote/${source} /remote/${target}`);
      save(join(output, `same-view-${existing}.json`), { result, source: (await read(`vfs/${source}`)).toString("base64"),
        target: await wire("GET", `/${bucket}/vfs/${target}`) });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await read(`vfs/${target}`), bytes);
      assert.deepEqual(await read(`vfs/${source}`), bytes);
    });
  }
  await test("missing authority remains unknown and refuses existing target before content", async () => {
    await put("unknown/source", bytes); await memory.writeFile("/unknown-target", previous);
    const unknown = new S3FileSystem({ transport: fallback, bucket, prefix: "unknown" });
    const view = createMountFileSystem({ root: memory, mounts: { "/remote": unknown } });
    const start = trace.length;
    assert.equal(await unknown.compareEntry("/source", memory, "/unknown-target"), "unknown");
    await assert.rejects(view.copyFile("/remote/source", "/unknown-target"), fsCode("ENOTSUP"));
    assert.ok(trace.slice(start).every(entry => entry.method === "HEAD" || entry.method === "GET" && entry.path.includes("list-type=2")));
    assert.deepEqual(Buffer.from(await memory.readFile("/unknown-target")), previous);
    assert.deepEqual(await read("unknown/source"), bytes);
  });
  await test("honest conditional-delete gap refuses adapter rename before all I/O", async () => {
    await put("vfs/rename-source", bytes); await put("vfs/rename-target", previous);
    const start = trace.length;
    assert.equal(remote.capabilities.atomicRename, false);
    await assert.rejects(remote.rename("/rename-source", "/rename-target"), fsCode("ENOTSUP"));
    assert.equal(trace.length, start);
    assert.deepEqual(await read("vfs/rename-source"), bytes); assert.deepEqual(await read("vfs/rename-target"), previous);
  });
  await test("conditional PUT fallback updates metadata without server COPY", async () => {
    await put("vfs/timestamps", bytes);
    const start = trace.length;
    await remote.utimes("/timestamps", 1234000, 5678000);
    const stat = await remote.stat("/timestamps");
    assert.equal(stat.atimeMs, 1234000); assert.equal(stat.mtimeMs, 5678000);
    assert.deepEqual(Buffer.from(await remote.readFile("/timestamps")), bytes);
    assert.ok(trace.slice(start).some(entry => entry.method === "PUT" && entry.headers["if-match"]));
    assert.ok(trace.slice(start).every(entry => !entry.headers["x-amz-copy-source"]));
  });
  const summary = { passed: results.filter(result => result.passed).length, total: results.length,
    capabilities: transport.capabilities, publicExistingExports: true, newTransportImport: "isolated dist/fs/s3/http/index.js pending approved package export" };
  save(join(output, "transport-summary.json"), summary); console.log(JSON.stringify(summary));
  if (summary.passed !== summary.total) process.exitCode = 1;
});

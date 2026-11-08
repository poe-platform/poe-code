import assert from "node:assert/strict";
import { request as nativeRequest } from "node:http";
import { join } from "node:path";
import { FsError } from "virtual-bash";
import { createS3HttpTransport } from "../../../../../dist/fs/s3/http/index.js";
import { save, withService } from "./service.mjs";

const sourceBytes = Buffer.from([0, 255, 128, 65, 13, 10]);
const targetBytes = Buffer.from([79, 76, 68]);
const competingBytes = Buffer.from([78, 69, 87]);
const serviceError = (status, code) => error => {
  assert.equal(error?.$metadata?.httpStatusCode, status);
  if (code) assert.equal(error.code, code);
  return true;
};

await withService(process.argv[2], async ({ endpoint, credentials, bucket, output, wire }) => {
  const trace = [], snapshots = [], results = [];
  const request = hook => (options, callback) => {
    assert.equal(options.hostname, "127.0.0.1");
    assert.equal(String(options.port), new URL(endpoint).port);
    const entry = { method: options.method, path: options.path, headers: options.headers };
    trace.push(entry);
    return nativeRequest(options, response => {
      entry.status = response.statusCode;
      callback(response);
      hook?.(options, response);
    });
  };
  const options = { endpoint, region: "us-east-1", credentials, allowInsecureHttp: true, listUrlEncoding: "form",
    verifiedConditionalOperations: { put: true, copy: false, delete: false } };
  const native = createS3HttpTransport({ ...options, request: request() });
  const fallback = (hook, overrides = {}) => createS3HttpTransport({ ...options, ...overrides, enableCopy: false, request: request(hook) });
  const input = Key => ({ Bucket: bucket, Key });
  const put = (key, bytes, Metadata) => native.putObject({ ...input(key), Body: bytes, ...(Metadata ? { Metadata } : {}) });
  const read = async key => {
    const bytes = Buffer.from((await native.getObject(input(key))).Body);
    snapshots.push({ key, base64: bytes.toString("base64") });
    return bytes;
  };
  const head = key => native.headObject(input(key));
  const copy = (client, source, destination, conditions = {}) => client.copyObject({ ...input(destination), CopySource: `${bucket}/${source}`, ...conditions });
  const seed = async (name, existing = true) => {
    const source = `fallback/${name}-source`, destination = `fallback/${name}-destination`;
    await put(source, sourceBytes, { retained: "yes" });
    if (existing) await put(destination, targetBytes);
    return { source, destination, sourceTag: (await head(source)).ETag, targetTag: existing ? (await head(destination)).ETag : undefined };
  };
  const noPublication = start => assert.ok(trace.slice(start).every(entry => entry.method !== "PUT" && entry.method !== "DELETE"));
  const preserved = async (source, destination, expectedTarget = targetBytes) => {
    assert.deepEqual(await read(source), sourceBytes);
    if (expectedTarget === undefined) await assert.rejects(head(destination), serviceError(404));
    else assert.deepEqual(await read(destination), expectedTarget);
  };
  const test = async (name, run) => {
    const firstRequest = trace.length;
    try { await run(); results.push({ name, passed: true, firstRequest, endRequest: trace.length }); }
    catch (error) { results.push({ name, passed: false, firstRequest, endRequest: trace.length,
      error: { name: error.name, message: error.message, stack: error.stack, code: error.code } }); }
    save(join(output, "fallback-results.json"), results);
    save(join(output, "fallback-wire.json"), trace);
    save(join(output, "fallback-snapshots.json"), snapshots);
  };

  for (const existing of [true, false]) {
    await test(`bounded copy positive ${existing ? "existing IfMatch" : "missing IfNoneMatch"} uses conditional PUT only`, async () => {
      const { source, destination, sourceTag, targetTag } = await seed(`positive-${existing}`, existing);
      const start = trace.length;
      const result = await copy(fallback(), source, destination, { CopySourceIfMatch: sourceTag,
        ...(existing ? { IfMatch: targetTag } : { IfNoneMatch: "*" }) });
      assert.ok(result.CopyObjectResult.ETag);
      const published = trace.slice(start).filter(entry => entry.method === "PUT");
      assert.equal(published.length, 1);
      assert.equal(published[0].headers[existing ? "if-match" : "if-none-match"], existing ? targetTag : "*");
      assert.ok(trace.slice(start).every(entry => !entry.headers["x-amz-copy-source"] && entry.method !== "DELETE"));
      await preserved(source, destination, sourceBytes);
      assert.equal((await head(destination)).Metadata.retained, "yes");
    });
  }
  await test("stale explicit source condition rejects before publication", async () => {
    const { source, destination } = await seed("stale-source");
    const start = trace.length;
    await assert.rejects(copy(fallback(), source, destination, { CopySourceIfMatch: '"stale"' }), serviceError(412, "PreconditionFailed"));
    noPublication(start); await preserved(source, destination);
  });
  await test("missing source rejects before publication and preserves destination", async () => {
    const destination = "fallback/missing-source-destination";
    await put(destination, targetBytes);
    const start = trace.length;
    await assert.rejects(copy(fallback(), "fallback/no-source", destination), serviceError(404, "NoSuchKey"));
    noPublication(start); assert.deepEqual(await read(destination), targetBytes);
  });
  for (const condition of ["stale-match", "exclusive-existing", "match-missing"]) {
    await test(`actual conditional PUT ${condition} preserves destination and source`, async () => {
      const existing = condition !== "match-missing";
      const { source, destination, sourceTag } = await seed(condition, existing);
      const start = trace.length;
      await assert.rejects(copy(fallback(), source, destination, { CopySourceIfMatch: sourceTag,
        ...(condition === "exclusive-existing" ? { IfNoneMatch: "*" } : { IfMatch: '"stale"' }) }), serviceError(existing ? 412 : 404));
      const publications = trace.slice(start).filter(entry => entry.method === "PUT");
      assert.equal(publications.length, 1);
      assert.equal(publications[0].status, existing ? 412 : 404);
      if (existing) await preserved(source, destination);
      else { assert.deepEqual(await read(source), sourceBytes); await assert.rejects(head(destination), serviceError(404)); }
    });
  }
  for (const existing of [true, false]) {
    await test(`destination ${existing ? "replacement" : "creation"} race after observed state cannot be overwritten`, async () => {
      const { source, destination, sourceTag } = await seed(`race-${existing}`, existing);
      let injections = 0, credentialCalls = 0;
      const client = fallback(undefined, { credentials: async ({ signal }) => {
        credentialCalls++;
        if (credentialCalls === 2) {
          assert.equal(trace.at(-1).method, "HEAD");
          assert.equal(trace.at(-1).path, `/${bucket}/${destination}`);
          injections++;
          const response = await wire("PUT", `/${bucket}/${destination}`, { body: competingBytes });
          assert.equal(response.status, 200);
        }
        signal.throwIfAborted();
        return credentials;
      } });
      const start = trace.length;
      await assert.rejects(copy(client, source, destination, { CopySourceIfMatch: sourceTag }), serviceError(412, "PreconditionFailed"));
      assert.equal(injections, 1);
      const publication = trace.slice(start).find(entry => entry.method === "PUT");
      assert.ok(publication); assert.equal(publication.status, 412);
      assert.ok(publication.headers[existing ? "if-match" : "if-none-match"]);
      await preserved(source, destination, competingBytes);
    });
  }
  await test("source replacement between target observation and GET rejects before publication", async () => {
    const { source, destination, sourceTag } = await seed("source-race");
    let injections = 0, credentialCalls = 0;
    const client = fallback(undefined, { credentials: async ({ signal }) => {
      credentialCalls++;
      if (credentialCalls === 2) {
        assert.equal(trace.at(-1).method, "HEAD");
        assert.equal(trace.at(-1).path, `/${bucket}/${destination}`);
        injections++;
        assert.equal((await wire("PUT", `/${bucket}/${source}`, { body: competingBytes })).status, 200);
      }
      signal.throwIfAborted();
      return credentials;
    } });
    const start = trace.length;
    await assert.rejects(copy(client, source, destination, { CopySourceIfMatch: sourceTag }), serviceError(412, "PreconditionFailed"));
    assert.equal(injections, 1); noPublication(start);
    assert.deepEqual(await read(source), competingBytes); assert.deepEqual(await read(destination), targetBytes);
  });
  await test("caller abort after source headers preserves exact reason and prevents publication", async () => {
    const { source, destination, sourceTag } = await seed("abort");
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { message: "synthetic caller abort" });
    const client = fallback(options => { if (options.method === "GET") controller.abort(reason); });
    const start = trace.length;
    await assert.rejects(client.copyObject({ ...input(destination), CopySource: `${bucket}/${source}`, CopySourceIfMatch: sourceTag },
      { abortSignal: controller.signal }), error => error === reason);
    noPublication(start); await preserved(source, destination);
  });
  await test("bounded copy byte limit refuses publication without truncating either entry", async () => {
    const { source, destination } = await seed("limit");
    const start = trace.length;
    await assert.rejects(copy(fallback(undefined, { maxPutBytes: sourceBytes.length - 1 }), source, destination), serviceError(413, "EntityTooLarge"));
    noPublication(start); await preserved(source, destination);
  });
  await test("self-copy metadata REPLACE preserves bytes under source and target predicates", async () => {
    const { source, sourceTag } = await seed("self");
    const start = trace.length;
    await copy(fallback(), source, source, { CopySourceIfMatch: sourceTag, IfMatch: sourceTag, MetadataDirective: "REPLACE", Metadata: { replacement: "yes" } });
    assert.deepEqual(await read(source), sourceBytes);
    assert.deepEqual(Object.entries((await head(source)).Metadata), [["replacement", "yes"]]);
    assert.ok(trace.slice(start).filter(entry => entry.method === "PUT").every(entry => entry.headers["if-match"] === sourceTag));
  });
  await test("unverified PUT cannot authorize a bounded copy fallback", async () => {
    const { source, destination } = await seed("unverified");
    const start = trace.length;
    await assert.rejects(copy(fallback(undefined, { verifiedConditionalOperations: {} }), source, destination), serviceError(501, "NotImplemented"));
    assert.equal(trace.length, start); await preserved(source, destination);
  });
  assert.ok(trace.every(entry => entry.method !== "DELETE" && !entry.headers["x-amz-copy-source"]));
  const summary = { passed: results.filter(result => result.passed).length, total: results.length,
    nativeVerifiedConditionalOperations: options.verifiedConditionalOperations, methodCapabilities: fallback().capabilities };
  save(join(output, "fallback-summary.json"), summary); console.log(JSON.stringify(summary));
  if (summary.passed !== summary.total) process.exitCode = 1;
});

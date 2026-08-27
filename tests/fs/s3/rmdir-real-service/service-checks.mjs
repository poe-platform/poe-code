import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { FsError, MemoryFileSystem, MountFileSystem, ReadOnlyFileSystem, Shell, standardCommands,
  createS3HttpTransport as rootFactory } from "virtual-bash";
import { S3FileSystem } from "virtual-bash/fs/s3";
import { createS3HttpTransport } from "virtual-bash/fs/s3/http";

assert.equal(rootFactory, createS3HttpTransport);

export async function runChecks({ wire, output, endpoint, credentials, bucket }) {
  const results = [];
  const trace = [];
  const errors = [];
  const save = () => {
    writeFileSync(join(output, "author-results.json"), JSON.stringify({ authorOnly: true, results,
      verifiedProductRmdirPositiveWorkflows: 0, requestedPositiveWorkflowBlocked: true }, null, 2) + "\n");
    writeFileSync(join(output, "product-requests.json"), JSON.stringify(trace, null, 2) + "\n");
    writeFileSync(join(output, "product-errors.json"), JSON.stringify(errors, null, 2) + "\n");
  };
  const check = async (name, classification, operation) => {
    const start = trace.length;
    try { const observation = await operation(); results.push({ name, classification, passed: true, observation, productRequests: [start, trace.length] }); }
    catch (error) {
      const diagnosticLists = [];
      for (const request of trace.slice(start).filter(entry => entry.method === "GET" && entry.path.includes("list-type=2")).slice(-2)) {
        const replay = await wire("GET", request.path);
        diagnosticLists.push({ path: request.path, sequence: replay.sequence, status: replay.status, body: replay.bodyText });
      }
      results.push({ name, classification, passed: false, error: String(error), stack: error.stack, diagnosticLists });
    }
    finally { save(); }
  };
  const client = (overrides = {}) => createS3HttpTransport({ endpoint, credentials, region: "us-east-1", allowInsecureHttp: true,
    listUrlEncoding: "form", enableCopy: false, verifiedConditionalOperations: { put: true, copy: false, delete: false },
    request: (options, callback) => {
      trace.push({ method: options.method, path: options.path });
      return httpRequest(options, callback);
    }, ...overrides });
  const transport = client();
  assert.equal(transport.capabilities.conditionalDelete, false);
  const fs = new S3FileSystem({ transport, bucket, prefix: "author", pageSize: 1 });
  const shell = new Shell({ fs }).use(standardCommands());
  const path = key => `/${bucket}/author/${key}`;
  const put = async (key, body = Buffer.alloc(0), headers = {}) => {
    const response = await wire("PUT", path(key), { body, headers });
    assert.equal(response.status, 200, response.bodyText);
    return response;
  };
  const get = async (key, bytes) => {
    const response = await wire("GET", path(key));
    assert.equal(response.status, bytes === undefined ? 404 : 200, response.bodyText);
    if (bytes !== undefined) assert.deepEqual(response.body, bytes);
    return { status: response.status, bodyBase64: response.bodyBase64, metadataGeneration: response.headers["x-amz-meta-generation"] };
  };
  const noMutations = start => assert.ok(trace.slice(start).every(entry => entry.method === "HEAD" || entry.method === "GET"));
  const reject = async (filesystem, target, code, options) => {
    const start = trace.length;
    await assert.rejects(filesystem.rmdir(target, options), error => {
      errors.push({ target, expectedCode: code, code: error.code, syscall: error.syscall, path: error.path, message: error.message,
        cause: error.cause && { code: error.cause.code, syscall: error.cause.syscall, path: error.cause.path, message: error.cause.message } });
      assert.ok(error instanceof FsError);
      assert.equal(error.code, code);
      assert.equal(error.path, target);
      assert.equal(error.syscall, "rmdir");
      return true;
    });
    noMutations(start);
  };
  await check("packed Shell ordinary mkdir/write/read works", "positive non-rmdir product control", async () => {
    const response = await shell.exec("mkdir /work; printf payload > /work/file; cat /work/file");
    assert.equal(response.exitCode, 0, response.stderr);
    assert.equal(response.stdout, "payload");
    await get("work/", Buffer.alloc(0));
    await get("work/file", Buffer.from("payload"));
    return { exitCode: response.exitCode, stdout: response.stdout, conditionalDelete: transport.capabilities.conditionalDelete, capabilities: fs.capabilities };
  });
  await check("packed Shell ordinary empty rmdir remains blocked", "required positive product workflow NOT satisfied", async () => {
    assert.equal((await shell.exec("mkdir /empty")).exitCode, 0);
    const start = trace.length;
    const response = await shell.exec("rmdir /empty");
    assert.equal(response.exitCode, 1);
    assert.equal(response.stderr, "rmdir: ENOTSUP: S3 object deletion cannot atomically require an empty directory prefix, rmdir '/empty'\n");
    noMutations(start);
    await reject(fs, "/empty", "ENOTSUP");
    await get("empty/", Buffer.alloc(0));
    const rmDirectory = await shell.exec("rm -d /empty");
    assert.equal(rmDirectory.exitCode, 1);
    await get("empty/", Buffer.alloc(0));
    return { rmdir: response, rmDirectory, markerPreserved: true };
  });
  for (const [target, code] of [["/work/file", "ENOTDIR"], ["/work/file/", "ENOTDIR"], ["/missing", "ENOENT"], ["/work", "ENOTEMPTY"], ["/", "EBUSY"]]) {
    await check(`typed ${code} for ${target}`, "current product negative", async () => {
      await reject(fs, target, code);
      await get("work/", Buffer.alloc(0));
      await get("work/file", Buffer.from("payload"));
      return { code, markerAndChildPreserved: true };
    });
  }
  await check("native LIST page-size and delimiter isolation", "pinned provider listing counterexample, not conformance acceptance", async () => {
    const observations = [];
    await get("work/", Buffer.alloc(0));
    await get("work/file", Buffer.from("payload"));
    for (const maxKeys of [1, 2, 1000]) {
      for (const delimiter of [false, true]) {
        const query = `/${bucket}?list-type=2&encoding-type=url&prefix=author%2Fwork%2F&max-keys=${maxKeys}${delimiter ? "&delimiter=%2F" : ""}`;
        const response = await wire("GET", query);
        assert.equal(response.status, 200, response.bodyText);
        const keys = [...response.bodyText.matchAll(/<Key>([^<]*)<\/Key>/g)].map(match => decodeURIComponent(match[1]));
        const truncated = /<IsTruncated>true<\/IsTruncated>/.test(response.bodyText);
        const token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(response.bodyText)?.[1];
        observations.push({ maxKeys, delimiter, sequence: response.sequence, keys, truncated, token,
          omitsKnownChildWhileClaimingComplete: !keys.includes("author/work/file") && !truncated });
      }
    }
    const markerOnly = observations.find(entry => entry.maxKeys === 1 && entry.delimiter);
    assert.deepEqual(markerOnly.keys, ["author/work/"]);
    assert.equal(markerOnly.omitsKnownChildWhileClaimingComplete, true);
    const full = observations.find(entry => entry.maxKeys === 1000 && entry.delimiter);
    assert.deepEqual(full.keys, ["author/work/", "author/work/file"]);
    await get("work/", Buffer.alloc(0));
    await get("work/file", Buffer.from("payload"));
    return { observations, nativeResponseNotProductParserInvented: true, knownChildAndMarkerPreserved: true };
  });
  await check("default-page-size nonempty explicit directory", "separate public product control; original pageSize1 failure unchanged", async () => {
    const standard = new S3FileSystem({ transport, bucket, prefix: "author" });
    await reject(standard, "/work", "ENOTEMPTY");
    await get("work/", Buffer.alloc(0));
    await get("work/file", Buffer.from("payload"));
    return { code: "ENOTEMPTY", defaultPageSize: true, markerAndChildPreserved: true };
  });
  await check("implicit directory and nested marker remain nonempty", "current product negative", async () => {
    await put("implicit/deeper/file", Buffer.from([0, 255, 128]));
    await put("nested/child/");
    await reject(fs, "/implicit", "ENOTEMPTY");
    await reject(fs, "/nested", "ENOTEMPTY");
    await get("implicit/", undefined);
    await get("implicit/deeper/file", Buffer.from([0, 255, 128]));
    await get("nested/child/", Buffer.alloc(0));
    return { implicitMarkerAbsent: true, childrenPreserved: true };
  });
  await check("readonly wrapper, adapter readonly and mounted root", "public wrapper negatives", async () => {
    await reject(new ReadOnlyFileSystem(fs), "/empty", "EROFS");
    await reject(new S3FileSystem({ transport, bucket, prefix: "author", readOnly: true }), "/empty", "EROFS");
    const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/remote": fs } });
    await reject(mounted, "/remote", "EBUSY");
    await reject(mounted, "/remote/empty", "ENOTSUP");
    await get("empty/", Buffer.alloc(0));
    return { codes: ["EROFS", "EROFS", "EBUSY", "ENOTSUP"] };
  });
  await check("pre-abort makes no request", "current product cancellation", async () => {
    const start = trace.length;
    await reject(fs, "/empty", "ECANCELED", { signal: AbortSignal.abort(new FsError("ENOENT")) });
    assert.equal(trace.length, start);
    await get("empty/", Buffer.alloc(0));
    return { productRequests: 0, markerPreserved: true };
  });
  await check("service rejects incorrect synthetic signature", "native service and product permission negative", async () => {
    const denied = new S3FileSystem({ transport: client({ credentials: { ...credentials, secretAccessKey: "incorrect-synthetic-secret" } }), bucket, prefix: "author" });
    await reject(denied, "/empty/", "EACCES");
    await get("empty/", Buffer.alloc(0));
    return { code: "EACCES", markerPreserved: true };
  });
  await check("current rmdir preserves child inserted after complete list", "current product race refusal", async () => {
    await put("current-race/");
    let injected = false;
    const forwarding = { ...transport, listObjectsV2: async (input, options) => {
      const response = await transport.listObjectsV2(input, options);
      if (!injected && input.Prefix === "author/current-race/" && input.Delimiter === "/" && !response.IsTruncated) {
        injected = true;
        await put("current-race/child", Buffer.from("concurrent"));
      }
      return response;
    } };
    await reject(new S3FileSystem({ transport: forwarding, bucket, prefix: "author" }), "/current-race", "ENOTSUP");
    assert.equal(injected, true);
    await get("current-race/", Buffer.alloc(0));
    await get("current-race/child", Buffer.from("concurrent"));
    return { code: "ENOTSUP", markerAndChildPreserved: true, injection: "faithful host transport forwards actual complete LIST snapshot" };
  });
  await check("abort after actual LIST response precedes mutation", "current product cancellation boundary", async () => {
    await put("abort-list/");
    const controller = new AbortController();
    let entered = false;
    const forwarding = { ...transport, listObjectsV2: async (input, options) => {
      const response = await transport.listObjectsV2(input, options);
      if (input.Prefix === "author/abort-list/" && input.Delimiter === "/") {
        assert.equal(options.abortSignal, controller.signal);
        entered = true;
        controller.abort(new FsError("ENOENT"));
      }
      return response;
    } };
    await reject(new S3FileSystem({ transport: forwarding, bucket, prefix: "author" }), "/abort-list", "ECANCELED", { signal: controller.signal });
    assert.equal(entered, true);
    await get("abort-list/", Buffer.alloc(0));
    return { code: "ECANCELED", actualListCompleted: true, markerPreserved: true };
  });
  const snapshot = async name => {
    const result = await wire("GET", `/${bucket}?list-type=2&prefix=author%2F${name}%2F&delimiter=%2F`);
    assert.equal(result.status, 200, result.bodyText);
    assert.match(result.bodyText, /<IsTruncated>false<\/IsTruncated>/);
    assert.equal((result.bodyText.match(/<Key>/g) ?? []).length, 1);
    assert.ok(!result.bodyText.includes("<CommonPrefixes>"));
    return result.sequence;
  };
  await check("exact-marker DELETE positive primitive", "native primitive only; not product rmdir", async () => {
    await put("primitive-empty/");
    const listSequence = await snapshot("primitive-empty");
    const removed = await wire("DELETE", path("primitive-empty/"));
    assert.equal(removed.status, 204);
    await get("primitive-empty/", undefined);
    await assert.rejects(fs.stat("/primitive-empty"), { code: "ENOENT" });
    return { listSequence, deleteSequence: removed.sequence, status: removed.status, logicalDirectoryAbsentInQuiescentControl: true };
  });
  await check("snapshot marker deletion preserves children but violates logical removal", "proposed algorithm contract counterexample", async () => {
    await put("candidate-race/");
    const listSequence = await snapshot("candidate-race");
    await put("candidate-race/new-child", Buffer.from([0, 255, 10]));
    await put("candidate-race/new-dir/");
    await put("candidate-race/new-dir/nested", Buffer.from("nested"));
    const removed = await wire("DELETE", path("candidate-race/"));
    assert.equal(removed.status, 204);
    await get("candidate-race/", undefined);
    await get("candidate-race/new-child", Buffer.from([0, 255, 10]));
    await get("candidate-race/new-dir/", Buffer.alloc(0));
    await get("candidate-race/new-dir/nested", Buffer.from("nested"));
    assert.equal((await fs.stat("/candidate-race")).type, "directory");
    return { listSequence, deleteSequence: removed.sequence, markerDeleted: true, descendantsPreserved: 3,
      logicalDirectoryStillPresent: true, contractSatisfied: false, hypotheticalSuccessIsNotLogicalRemoval: true };
  });
  await check("same-content marker replacement ABA", "proposed algorithm identity limitation", async () => {
    const original = await put("candidate-aba/", Buffer.alloc(0), { "x-amz-meta-generation": "first" });
    const listSequence = await snapshot("candidate-aba");
    assert.equal((await wire("DELETE", path("candidate-aba/"))).status, 204);
    const replacement = await put("candidate-aba/", Buffer.alloc(0), { "x-amz-meta-generation": "replacement" });
    assert.equal(replacement.headers.etag, original.headers.etag);
    assert.equal((await get("candidate-aba/", Buffer.alloc(0))).metadataGeneration, "replacement");
    const removed = await wire("DELETE", path("candidate-aba/"));
    assert.equal(removed.status, 204);
    await get("candidate-aba/", undefined);
    return { listSequence, deleteSequence: removed.sequence, sameEtag: true, replacementMarkerDeleted: true, conditionalDeleteClaimed: false };
  });
  await check("native stale conditional DELETE does not justify capability", "pinned provider unsupported guard", async () => {
    await put("stale-delete", Buffer.from("preserve-me"));
    const response = await wire("DELETE", path("stale-delete"), { headers: { "If-Match": '"not-the-etag"' } });
    assert.equal(response.status, 204);
    await get("stale-delete", undefined);
    assert.equal(transport.capabilities.conditionalDelete, false);
    return { expectedForVerifiedConditionalDelete: 412, observedStatus: response.status, objectDeleted: true,
      providerGuardSupported: false, conditionalDeleteAdvertised: false };
  });
  await check("native wrong-signature marker DELETE preserves marker", "native primitive permission negative", async () => {
    await put("delete-denied/");
    const response = await wire("DELETE", path("delete-denied/"), { secret: "incorrect-synthetic-secret" });
    assert.equal(response.status, 403);
    await get("delete-denied/", Buffer.alloc(0));
    return { status: response.status, markerPreserved: true };
  });
  assert.equal(results.filter(result => !result.passed).length, 0, "author observations include failures; see author-results.json");
}

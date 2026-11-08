import assert from "node:assert/strict";
import { request as nativeRequest } from "node:http";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { FsError, Shell, standardCommands, createS3HttpTransport as rootFactory } from "virtual-bash";
import { S3FileSystem } from "virtual-bash/fs/s3";
import { createS3HttpTransport } from "virtual-bash/fs/s3/http";

assert.equal(rootFactory, createS3HttpTransport);

export const packageResolution = { root: import.meta.resolve("virtual-bash"), s3: import.meta.resolve("virtual-bash/fs/s3"),
  http: import.meta.resolve("virtual-bash/fs/s3/http") };

export async function runChecks({ wire, output, endpoint, credentials, bucket }) {
  const results = [], trace = [];
  const persist = () => {
    writeFileSync(join(output, "results.json"), JSON.stringify({ authorOnly: true, results,
      positivePublicWorkflows: results.filter(result => result.passed && result.kind === "public positive workflow").length,
      historicalServiceCohort: "19/20 unchanged", historicalMatrix: "77/79 not rerun" }, null, 2) + "\n");
    writeFileSync(join(output, "product-requests.json"), JSON.stringify(trace, null, 2) + "\n");
  };
  const check = async (name, kind, operation) => {
    const begin = trace.length;
    try { const observation = await operation(); results.push({ name, kind, passed: true, observation, productRequests: [begin, trace.length] }); }
    catch (error) { results.push({ name, kind, passed: false, error: String(error), stack: error.stack, productRequests: [begin, trace.length] }); }
    finally { persist(); }
  };
  const makeTransport = ({ credentialProvider = credentials, afterResponse = () => {} } = {}) => createS3HttpTransport({
    endpoint, region: "us-east-1", credentials: credentialProvider, allowInsecureHttp: true, listUrlEncoding: "form", enableCopy: false,
    verifiedConditionalOperations: { put: true, copy: false, delete: false },
    request: (options, callback) => {
      const entry = { method: options.method, path: options.path };
      trace.push(entry);
      return nativeRequest(options, message => {
        entry.status = message.statusCode;
        callback(message);
        afterResponse(entry);
      });
    },
  });
  const transport = makeTransport();
  const makeFs = (selected = transport, options = {}) => new S3FileSystem({ transport: selected, bucket, prefix: "snapshot", pageSize: 1, ...options });
  const fs = makeFs();
  const shell = new Shell({ fs }).use(standardCommands());
  const path = key => `/${bucket}/snapshot/${key}`;
  const put = async (key, body = Buffer.alloc(0), headers = {}) => {
    const response = await wire("PUT", path(key), { body, headers });
    assert.equal(response.status, 200, response.bodyText);
    return response;
  };
  const get = async (key, expected) => {
    const response = await wire("GET", path(key));
    assert.equal(response.status, expected === undefined ? 404 : 200, response.bodyText);
    if (expected !== undefined) assert.deepEqual(response.body, expected);
    return { sequence: response.sequence, status: response.status, bodyBase64: response.bodyBase64, headers: response.headers };
  };
  const exactDelete = (start, key) => {
    const deletes = trace.slice(start).filter(entry => entry.method === "DELETE");
    assert.equal(deletes.length, 1);
    assert.equal(deletes[0].path, path(key));
    assert.equal(deletes[0].status, 204);
    return deletes;
  };
  const reject = async (filesystem, target, code, options) => {
    await assert.rejects(filesystem.rmdir(target, options), error => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, code);
      assert.equal(error.path, target);
      assert.equal(error.syscall, "rmdir");
      return true;
    });
  };
  await check("public capability and unchanged provider declarations", "public profile", async () => {
    assert.equal(fs.capabilities.snapshotRmdir, true);
    assert.equal(fs.capabilities.atomicRename, false);
    assert.equal(transport.capabilities.conditionalDelete, false);
    return { filesystem: fs.capabilities, transport: transport.capabilities };
  });
  await check("public API removes quiescent explicit marker", "public positive workflow", async () => {
    await fs.mkdir("/api");
    await get("api/", Buffer.alloc(0));
    const start = trace.length;
    await fs.rmdir("/api");
    const deletes = exactDelete(start, "api/");
    await get("api/", undefined);
    await assert.rejects(fs.stat("/api"), { code: "ENOENT" });
    return { deletes, absentInQuiescentControl: true };
  });
  for (const [key, command] of [["shell", "rmdir"], ["rm-dir", "rm -d"]]) {
    await check(`packed Shell ${command} removes explicit marker`, "public positive workflow", async () => {
      assert.equal((await shell.exec(`mkdir /${key}`)).exitCode, 0);
      await get(`${key}/`, Buffer.alloc(0));
      const start = trace.length;
      const result = await shell.exec(`${command} /${key}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      const deletes = exactDelete(start, `${key}/`);
      await get(`${key}/`, undefined);
      return { exitCode: result.exitCode, deletes };
    });
  }
  await check("packed byte pipeline and pipeline rmdir cleanup", "public positive workflow", async () => {
    const result = await shell.exec("mkdir /pipeline; printf '\\000\\377\\200\\n' | tee /pipeline/file | cat");
    const payload = Buffer.from([0, 255, 128, 10]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Buffer.from(result.stdoutBytes), payload);
    await get("pipeline/file", payload);
    assert.equal((await shell.exec("rm /pipeline/file")).exitCode, 0);
    const start = trace.length;
    const removed = await shell.exec("printf ignored | rmdir /pipeline");
    assert.equal(removed.exitCode, 0, removed.stderr);
    const deletes = exactDelete(start, "pipeline/");
    await get("pipeline/", undefined);
    await get("pipeline/file", undefined);
    return { pipelineBytes: [...payload], exitCode: removed.exitCode, deletes, knownFileRemovalWasExplicit: true };
  });
  await put("nonempty/");
  await put("nonempty/file", Buffer.from([0, 255, 7]));
  for (const pageSize of [1, 1000]) {
    await check(`nonempty marker with configured pageSize=${pageSize}`, "public nonempty guard", async () => {
      const start = trace.length;
      await reject(makeFs(transport, { pageSize }), "/nonempty", "ENOTEMPTY");
      assert.equal(trace.slice(start).some(entry => entry.method === "DELETE"), false);
      const inspection = trace.slice(start).filter(entry => entry.method === "GET" && entry.path.includes("delimiter="));
      assert.equal(inspection.length, 1);
      const query = new URL(inspection[0].path, endpoint).searchParams;
      assert.equal(Number(query.get("max-keys")), Math.max(2, pageSize));
      await get("nonempty/", Buffer.alloc(0));
      await get("nonempty/file", Buffer.from([0, 255, 7]));
      return { code: "ENOTEMPTY", inspection, requestPolicyChangedNotOldOracleExpectation: true };
    });
  }
  await put("implicit/nested/");
  for (const [target, code] of [["/nonempty/file", "ENOTDIR"], ["/missing", "ENOENT"], ["/", "EBUSY"], ["/implicit", "ENOTEMPTY"]]) {
    await check(`${target} retains ${code}`, "public negative", async () => {
      const start = trace.length;
      await reject(fs, target, code);
      assert.ok(trace.slice(start).every(entry => entry.method === "GET" || entry.method === "HEAD"));
      await get("nonempty/file", Buffer.from([0, 255, 7]));
      await get("implicit/nested/", Buffer.alloc(0));
      return { code, descendantsPreserved: true };
    });
  }
  await check("readonly and pre-aborted profile make no requests", "public denial", async () => {
    await put("deny/");
    const start = trace.length;
    await reject(makeFs(transport, { readOnly: true }), "/deny", "EROFS");
    await reject(fs, "/deny", "ECANCELED", { signal: AbortSignal.abort(new FsError("ENOENT")) });
    assert.equal(trace.length, start);
    await get("deny/", Buffer.alloc(0));
    return { codes: ["EROFS", "ECANCELED"], requests: 0 };
  });
  await check("ambiguous file-prefix representation is not deleted", "public representation guard", async () => {
    await put("ambiguous", Buffer.from("file"));
    await put("ambiguous/");
    const start = trace.length;
    await reject(fs, "/ambiguous", "ENOTSUP");
    assert.equal(trace.slice(start).some(entry => entry.method === "DELETE"), false);
    await get("ambiguous", Buffer.from("file"));
    await get("ambiguous/", Buffer.alloc(0));
    return { code: "ENOTSUP", bothEntriesPreserved: true };
  });
  await check("late nested descendants survive successful public rmdir", "public snapshot race", async () => {
    await put("race/");
    let injected = false;
    const forwarding = { ...transport, listObjectsV2: async (input, options) => {
      const snapshot = await transport.listObjectsV2(input, options);
      if (!injected && input.Prefix === "snapshot/race/" && input.Delimiter === "/" && !snapshot.IsTruncated) {
        injected = true;
        await put("race/file", Buffer.from([0, 255]));
        await put("race/nested/");
        await put("race/nested/file", Buffer.from([128, 10]));
      }
      return snapshot;
    } };
    const start = trace.length;
    await makeFs(forwarding).rmdir("/race");
    assert.equal(injected, true);
    const deletes = exactDelete(start, "race/");
    await get("race/", undefined);
    await get("race/file", Buffer.from([0, 255]));
    await get("race/nested/", Buffer.alloc(0));
    await get("race/nested/file", Buffer.from([128, 10]));
    assert.equal((await fs.stat("/race")).type, "directory");
    return { deletes, survivingDescendants: 3, logicalDirectoryStillVisible: true, markerRollback: false };
  });
  await check("public unconditional marker removal characterizes same-content ABA", "public snapshot identity limit", async () => {
    const original = await put("aba/", Buffer.alloc(0), { "x-amz-meta-generation": "original" });
    const forwarding = { ...transport, deleteObject: async (input, options) => {
      assert.deepEqual(input, { Bucket: bucket, Key: "snapshot/aba/" });
      assert.equal((await wire("DELETE", path("aba/"))).status, 204);
      const replacement = await put("aba/", Buffer.alloc(0), { "x-amz-meta-generation": "replacement" });
      assert.equal(replacement.headers.etag, original.headers.etag);
      await get("aba/", Buffer.alloc(0));
      return transport.deleteObject(input, options);
    } };
    const start = trace.length;
    await makeFs(forwarding).rmdir("/aba");
    const deletes = exactDelete(start, "aba/");
    await get("aba/", undefined);
    return { deletes, sameEtag: true, replacementRemoved: true, atomicIdentityClaim: false };
  });
  await check("DELETE authorization failure preserves typed error and marker", "actual service error", async () => {
    await put("forbidden/");
    let denyDelete = false;
    const selected = makeTransport({ credentialProvider: async () => denyDelete ? { ...credentials, secretAccessKey: "incorrect-synthetic-secret" } : credentials });
    const forwarding = { ...selected, deleteObject: async (input, options) => {
      denyDelete = true;
      try { return await selected.deleteObject(input, options); } finally { denyDelete = false; }
    } };
    const start = trace.length;
    await reject(makeFs(forwarding), "/forbidden/", "EACCES");
    const deletes = trace.slice(start).filter(entry => entry.method === "DELETE");
    assert.equal(deletes.length, 1);
    assert.equal(deletes[0].status, 403);
    await get("forbidden/", Buffer.alloc(0));
    return { code: "EACCES", deletes, markerPreserved: true };
  });
  await check("abort after actual LIST prevents DELETE", "actual service cancellation boundary", async () => {
    await put("abort-list/");
    const controller = new AbortController();
    const forwarding = { ...transport, listObjectsV2: async (input, options) => {
      const snapshot = await transport.listObjectsV2(input, options);
      if (input.Prefix === "snapshot/abort-list/" && input.Delimiter === "/") controller.abort(new FsError("ENOENT"));
      return snapshot;
    } };
    const start = trace.length;
    await reject(makeFs(forwarding), "/abort-list", "ECANCELED", { signal: controller.signal });
    assert.equal(trace.slice(start).some(entry => entry.method === "DELETE"), false);
    await get("abort-list/", Buffer.alloc(0));
    return { code: "ECANCELED", markerPreserved: true };
  });
  await check("abort during issued DELETE after HTTP204 retains completed effect", "actual service cancellation with effects", async () => {
    await put("abort-delete/");
    const controller = new AbortController();
    let received = false;
    const selected = makeTransport({ afterResponse: entry => {
      if (entry.method === "DELETE") {
        assert.equal(entry.status, 204);
        received = true;
        controller.abort(new FsError("ENOENT"));
      }
    } });
    const start = trace.length;
    await reject(makeFs(selected), "/abort-delete", "ECANCELED", { signal: controller.signal });
    assert.equal(received, true);
    const deletes = exactDelete(start, "abort-delete/");
    await get("abort-delete/", undefined);
    return { code: "ECANCELED", deletes, markerAbsentAfterAbort: true, responseCallbackForwardedBeforeAbort: true };
  });
  await check("host response-loss error does not roll back actual service deletion", "synthetic host error after actual service success", async () => {
    await put("lost-response/");
    const forwarding = { ...transport, deleteObject: async (input, options) => {
      await transport.deleteObject(input, options);
      throw new Error("controlled host response loss after completed deletion");
    } };
    const start = trace.length;
    await reject(makeFs(forwarding), "/lost-response", "EIO");
    const deletes = exactDelete(start, "lost-response/");
    await get("lost-response/", undefined);
    return { code: "EIO", deletes, actualServerEffect: true, syntheticFailureAfterSuccess: true };
  });
  await check("native stale If-Match still does not verify conditional DELETE", "native provider limitation", async () => {
    await put("guard", Buffer.from("guard-bytes"));
    const response = await wire("DELETE", path("guard"), { headers: { "If-Match": '"stale"' } });
    assert.equal(response.status, 204);
    await get("guard", undefined);
    assert.equal(transport.capabilities.conditionalDelete, false);
    return { observed: response.status, requiredForVerifiedGuard: 412, conditionalDelete: false };
  });
  assert.equal(results.filter(result => !result.passed).length, 0, "service assertions failed; original results retained");
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { TestContext } from "node:test";
import test from "node:test";
import { S3FileSystem } from "../../../../../src/fs/s3/filesystem.js";
import { MemoryFileSystem } from "../../../../../src/fs/memory/index.js";
import { MountFileSystem } from "../../../../../src/fs/mount/index.js";
import { Shell } from "../../../../../src/shell/index.js";
import { standardCommands } from "../../../../../src/commands/index.js";
import { date, key, serverFor } from "./helpers.js";

const etag = (bytes: Uint8Array): string => `"${createHash("sha256").update(bytes).digest("hex")}"`;
const payload = Buffer.from([0, 128, 255]);
const previous = Buffer.from([4, 5]);

async function provider(context: TestContext, options: { readonly race?: "existing" | "missing"; readonly denyGet?: boolean; readonly controller?: AbortController } = {}) {
  const objects = new Map<string, Uint8Array>([["source", payload], ["target", previous]]);
  const trace: { method: string; path: string; condition: string | undefined; metadata: Record<string, string> }[] = [];
  const fixture = await serverFor(context, (request, response, bytes) => {
    const name = decodeURIComponent(request.url!.split("?")[0]!.slice("/testbucket/".length));
    const method = request.method!;
    const metadata = Object.fromEntries(Object.entries(request.headers).filter(([header]) => header.startsWith("x-amz-meta-")).map(([header, value]) => [header.slice(11), String(value)]));
    trace.push({ method, path: name, condition: request.headers["if-match"] as string | undefined ?? request.headers["if-none-match"] as string | undefined, metadata });
    assert.equal(request.headers["x-amz-copy-source"], undefined);
    if (request.url!.includes("?")) {
      response.end("<ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>0</KeyCount></ListBucketResult>");
      return;
    }
    const current = objects.get(name);
    if (method === "GET" && options.denyGet) { response.writeHead(403); response.end(); return; }
    if (request.headers["if-match"] !== undefined && (!current || request.headers["if-match"] !== etag(current))) {
      response.writeHead(412); response.end(); return;
    }
    if (request.headers["if-none-match"] === "*" && current) { response.writeHead(412); response.end(); return; }
    if (method === "HEAD" || method === "GET") {
      if (!current) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "content-length": current.length, etag: etag(current), "last-modified": new Date(date).toUTCString(), "x-amz-meta-origin": "source-metadata" });
      if (method === "GET") {
        if (options.race) objects.set(options.race === "existing" ? "target" : "new", Buffer.from("raced"));
        response.end(current);
        options.controller?.abort(new Error("between GET and PUT"));
      } else response.end();
    } else if (method === "PUT") {
      assert.ok(request.headers["if-match"] || request.headers["if-none-match"], "fallback never PUTs unconditionally");
      objects.set(name, new Uint8Array(bytes));
      response.writeHead(200, { etag: etag(bytes) }); response.end();
    } else assert.fail(`unexpected ${method}`);
  });
  const client = fixture.transport({ enableCopy: false, verifiedConditionalOperations: { put: true } });
  return { ...fixture, client, objects, trace };
}

for (const target of ["target", "new"]) test(`disabled native COPY uses guarded bounded fallback to ${target}`, async context => {
  const fixture = await provider(context);
  const result = await fixture.client.copyObject({ ...key, Key: target, CopySource: "testbucket/source", CopySourceIfMatch: etag(payload) });
  assert.equal(result.CopyObjectResult?.ETag, etag(payload));
  assert.deepEqual([...fixture.objects.get(target)!], [...payload]);
  assert.deepEqual(fixture.objects.get("source"), payload);
  assert.deepEqual(fixture.trace.map(entry => entry.method), ["HEAD", "GET", "PUT"]);
  assert.equal(fixture.trace[2]!.condition, target === "target" ? etag(previous) : "*");
  assert.deepEqual(fixture.trace[2]!.metadata, { origin: "source-metadata" });
  assert.equal(fixture.client.capabilities?.conditionalCopy, true);
  assert.equal(fixture.client.capabilities?.conditionalDelete, false);
});

for (const race of ["existing", "missing"] as const) test(`fallback preserves a ${race} destination race with no source deletion`, async context => {
  const fixture = await provider(context, { race });
  const target = race === "existing" ? "target" : "new";
  await assert.rejects(fixture.client.copyObject({ ...key, Key: target, CopySource: "testbucket/source", CopySourceIfMatch: etag(payload) }), { code: "PreconditionFailed" });
  assert.deepEqual(fixture.objects.get(target), Buffer.from("raced"));
  assert.deepEqual(fixture.objects.get("source"), payload);
  assert.equal(fixture.trace.some(entry => entry.method === "DELETE"), false);
});

test("fallback preserves caller predicates and propagates source denial without PUT", async context => {
  const fixture = await provider(context, { denyGet: true });
  await assert.rejects(fixture.client.copyObject({ ...key, Key: "target", CopySource: "testbucket/source", IfMatch: etag(previous) }), { code: "AccessDenied" });
  assert.deepEqual(fixture.trace.map(entry => entry.method), ["GET"]);
  assert.deepEqual(fixture.objects.get("target"), previous);
});

test("fallback preserves stale source and explicit destination predicates", async context => {
  const fixture = await provider(context);
  await assert.rejects(fixture.client.copyObject({ ...key, Key: "target", CopySource: "testbucket/source", CopySourceIfMatch: '"stale"', IfMatch: etag(previous) }), { code: "PreconditionFailed" });
  assert.deepEqual(fixture.trace.map(entry => entry.method), ["GET"]);
  assert.deepEqual(fixture.objects.get("target"), previous);
  await assert.rejects(fixture.client.copyObject({ ...key, Key: "target", CopySource: "testbucket/source", IfNoneMatch: "*" }), { code: "PreconditionFailed" });
  assert.equal(fixture.trace.at(-1)?.condition, "*");
  assert.deepEqual(fixture.objects.get("target"), previous);
  assert.deepEqual(fixture.objects.get("source"), payload);
});

test("fallback cancellation before publication preserves bytes", async context => {
  const controller = new AbortController();
  const fixture = await provider(context, { controller });
  await assert.rejects(fixture.client.copyObject({ ...key, Key: "target", CopySource: "testbucket/source" }, { abortSignal: controller.signal }), error => error === controller.signal.reason);
  assert.equal(fixture.trace.some(entry => entry.method === "PUT"), false);
  assert.deepEqual(fixture.objects.get("target"), previous);
});

test("bounded fallback rejects oversized source before destination PUT", async context => {
  const fixture = await provider(context);
  const client = fixture.transport({ enableCopy: false, maxPutBytes: 2, verifiedConditionalOperations: { put: true } });
  await assert.rejects(client.copyObject({ ...key, Key: "target", CopySource: "testbucket/source" }), { code: "EntityTooLarge" });
  assert.equal(fixture.trace.some(entry => entry.method === "PUT"), false);
  assert.deepEqual(fixture.objects.get("target"), previous);
});

test("fallback self-copy REPLACE preserves bytes and replaces metadata under IfMatch", async context => {
  const fixture = await provider(context);
  const result = await fixture.client.copyObject({ ...key, Key: "source", CopySource: "testbucket/source",
    CopySourceIfMatch: etag(payload), IfMatch: etag(payload), MetadataDirective: "REPLACE", Metadata: { "virtual-bash-mtime": "1234" } });
  assert.equal(result.CopyObjectResult?.ETag, etag(payload));
  assert.deepEqual([...fixture.objects.get("source")!], [...payload]);
  assert.deepEqual(fixture.trace.map(entry => entry.method), ["GET", "PUT"]);
  assert.deepEqual(fixture.trace.at(-1)?.metadata, { "virtual-bash-mtime": "1234" });
  assert.equal(fixture.trace.at(-1)?.condition, etag(payload));
});

test("actual Shell same-view cp existing and missing targets works with native COPY disabled", async context => {
  const fixture = await provider(context);
  const filesystem = new S3FileSystem({ transport: fixture.client, bucket: key.Bucket, allowNonAtomicRename: true });
  const shell = new Shell({ fs: filesystem }).use(standardCommands());
  for (const target of ["target", "new"]) {
    const result = await shell.exec(`cp /source /${target}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual([...fixture.objects.get(target)!], [...payload]);
  }
  assert.deepEqual(fixture.objects.get("source"), payload);
  const before = fixture.trace.length;
  await assert.rejects(filesystem.rename("/source", "/target"), { code: "ENOTSUP" });
  assert.equal(fixture.trace.length, before);
  await filesystem.copyFile("/source", "/other", { exclusive: true });
  assert.deepEqual([...fixture.objects.get("other")!], [...payload]);
  const writes = fixture.trace.filter(entry => entry.method === "PUT").length;
  await assert.rejects(filesystem.copyFile("/source", "/other", { exclusive: true }), { code: "EEXIST" });
  assert.equal(fixture.trace.filter(entry => entry.method === "PUT").length, writes);
});

test("mounted same-view missing-target cp reaches guarded exclusive HTTP fallback", async context => {
  const fixture = await provider(context);
  const filesystem = new S3FileSystem({ transport: fixture.client, bucket: key.Bucket, allowNonAtomicRename: true });
  const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/remote": filesystem } });
  const shell = new Shell({ fs: mounted }).use(standardCommands());
  const result = await shell.exec("cp /remote/source /remote/mounted-new");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual([...fixture.objects.get("mounted-new")!], [...payload]);
  assert.deepEqual(fixture.objects.get("source"), payload);
  assert.equal(fixture.trace.find(entry => entry.method === "PUT" && entry.path === "mounted-new")?.condition, "*");
  assert.equal(fixture.trace.some(entry => entry.method === "DELETE"), false);
  assert.equal(filesystem.capabilities.atomicRename, false);
});

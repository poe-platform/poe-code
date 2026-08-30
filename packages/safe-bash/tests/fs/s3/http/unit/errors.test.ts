import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request as nodeRequest } from "node:http";
import type { ClientRequest, IncomingMessage } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { S3FileSystem } from "../../../../../src/fs/s3/filesystem.js";
import { bodyBytes, key, serverFor } from "./helpers.js";

for (const [status, code, errno] of [[403, "AccessDenied", "EACCES"], [404, "NoSuchKey", "ENOENT"],
  [412, "PreconditionFailed", "EAGAIN"], [409, "ConditionalRequestConflict", "EAGAIN"], [501, "NotImplemented", "ENOTSUP"]] as const) {
  test(`provider ${code} is typed and retains HTTP ${status}`, async context => {
    const fixture = await serverFor(context, (_request, response) => { response.writeHead(status); response.end(`<Error><Code>${code}</Code><Message>failure &amp; detail</Message></Error>`); });
    const client = fixture.transport();
    await assert.rejects(client.getObject(key), { code, $metadata: { httpStatusCode: status }, message: "failure & detail" });
    if (status !== 404) {
      const filesystem = new S3FileSystem({ transport: client, bucket: key.Bucket });
      await assert.rejects(filesystem.stat("/key"), { code: errno });
    }
  });
}

test("empty HEAD error remains typed and never requires XML", async context => {
  const fixture = await serverFor(context, (_request, response) => { response.writeHead(404); response.end(); });
  await assert.rejects(fixture.transport().headObject(key), { code: "NotFound", $metadata: { httpStatusCode: 404 } });
});

test("HTTP 200 embedded COPY error is failure after the complete body", async context => {
  const fixture = await serverFor(context, (_request, response) => { response.write(" \n<Error>"); response.end("<Code>SlowDown</Code><Message>retry</Message></Error>"); });
  await assert.rejects(fixture.transport().copyObject({ ...key, CopySource: "testbucket/source" }), { code: "SlowDown", $metadata: { httpStatusCode: 200 } });
});

test("redirects never replay credentials to their target", async context => {
  const target = await serverFor(context, (_request, response) => { response.end("leaked"); });
  const origin = await serverFor(context, (_request, response) => { response.writeHead(307, { location: `${target.endpoint}/testbucket/key` }); response.end(); });
  await assert.rejects(origin.transport().getObject(key), { code: "RedirectRejected", $metadata: { httpStatusCode: 307 } });
  assert.equal(origin.requests(), 1);
  assert.equal(target.requests(), 0);
});

test("pre-abort and cancellation during asynchronous credentials cause no request", async context => {
  const fixture = await serverFor(context, (_request, response) => { response.end(); });
  const controller = new AbortController();
  const reason = new Error("cancel credentials");
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let rejectCredentials!: (error: Error) => void;
  const client = fixture.transport({ credentials: async ({ signal }) => {
    assert.equal(signal.aborted, false);
    entered();
    return await new Promise((_resolve, reject) => { rejectCredentials = reject; });
  } });
  const pending = client.getObject(key, { abortSignal: controller.signal });
  await started;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  rejectCredentials(new Error("late credential rejection"));
  await assert.rejects(client.getObject(key, { abortSignal: controller.signal }), error => error === reason);
  assert.equal(fixture.requests(), 0);
});

test("credential deadline remains live without sockets or other event-loop handles", () => {
  const module = new URL("../../../../../src/fs/s3/http/index.ts", import.meta.url).href;
  const script = `import { createS3HttpTransport } from ${JSON.stringify(module)};
const transport = createS3HttpTransport({ endpoint: 'https://s3.example.invalid', region: 'us-east-1',
  credentials: async () => new Promise(() => {}), requestTimeoutMs: 20 });
try { await transport.headObject({ Bucket: 'testbucket', Key: 'key' }); process.exitCode = 1; }
catch (error) { if (error.code !== 'RequestTimeout') throw error; console.log(error.code); }`;
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "--eval", script], { encoding: "utf8", timeout: 3000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "RequestTimeout\n");
});

test("abort while waiting for headers destroys the socket and observes late request errors", async context => {
  let arrived!: () => void;
  const started = new Promise<void>(resolve => { arrived = resolve; });
  let closed!: () => void;
  const closure = new Promise<void>(resolve => { closed = resolve; });
  const fixture = await serverFor(context, (_request, response) => { response.on("close", closed); arrived(); });
  const controller = new AbortController();
  const reason = new Error("cancel headers");
  let request: ClientRequest | undefined;
  const client = fixture.transport({ request(options, callback) { request = nodeRequest(options, callback); return request; } });
  const pending = client.getObject(key, { abortSignal: controller.signal });
  await started;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  await closure;
  request!.emit("error", new Error("late request failure"));
  assert.equal(request!.destroyed, true);
});

for (const consume of [false, true]) test(`abort after headers with ${consume ? "pending next" : "unread body"} destroys response`, async context => {
  let closed!: () => void;
  const closure = new Promise<void>(resolve => { closed = resolve; });
  const fixture = await serverFor(context, (_request, response) => { response.on("close", closed); response.writeHead(200); response.flushHeaders(); });
  let response: IncomingMessage | undefined;
  const controller = new AbortController();
  const reason = new Error("cancel body");
  const client = fixture.transport({ request(options, callback) { return nodeRequest(options, message => { response = message; callback(message); }); } });
  const output = await client.getObjectStream!(key, { abortSignal: controller.signal });
  const iterator = output.Body[Symbol.asyncIterator]();
  const pending = consume ? iterator.next() : undefined;
  controller.abort(reason);
  await assert.rejects(pending ?? iterator.next(), error => error === reason);
  await closure;
  response!.emit("error", new Error("late response failure"));
  assert.equal(response!.destroyed, true);
});

for (const consume of [false, true]) test(`iterator return ${consume ? "after first chunk" : "before first next"} releases socket`, async context => {
  let closed!: () => void;
  const closure = new Promise<void>(resolve => { closed = resolve; });
  const fixture = await serverFor(context, (_request, response) => { response.on("close", closed); response.write("first"); });
  const output = await fixture.transport().getObjectStream!(key);
  const iterator = output.Body[Symbol.asyncIterator]();
  if (consume) assert.equal((await iterator.next()).done, false);
  await iterator.return!();
  await closure;
});

for (const phase of ["headers", "body"]) test(`absolute request timeout aborts stalled ${phase}`, async context => {
  const fixture = await serverFor(context, (_request, response) => { if (phase === "body") { response.writeHead(200); response.flushHeaders(); } });
  await assert.rejects(fixture.transport({ requestTimeoutMs: 40 }).getObject(key), { code: "RequestTimeout", $metadata: { httpStatusCode: 408 } });
});

for (const declared of [false, true]) test(`${declared ? "declared" : "chunked"} GET limit destroys connection`, async context => {
  const fixture = await serverFor(context, (_request, response) => {
    response.writeHead(200, declared ? { "content-length": "100" } : {});
    response.write("too many bytes");
  });
  await assert.rejects(fixture.transport({ maxGetBytes: 3 }).getObject(key), { code: "EntityTooLarge" });
});

test("streaming reads do not eagerly consume a complete body", async context => {
  const fixture = await serverFor(context, (_request, response) => { response.write(Buffer.alloc(2 * 1024 * 1024, 7)); });
  let response: IncomingMessage | undefined;
  const client = fixture.transport({ request(options, callback) { return nodeRequest(options, message => { response = message; callback(message); }); } });
  const output = await client.getObjectStream!(key);
  await delay(25);
  assert.ok(response!.readableLength < 256 * 1024, `buffered ${response!.readableLength}`);
  await output.Body[Symbol.asyncIterator]().return!();
  assert.equal(response!.destroyed, true);
});

test("partial content with a wrong range or body length is rejected", async context => {
  let attempt = 0;
  const fixture = await serverFor(context, (_request, response) => {
    attempt++;
    response.writeHead(206, { "content-range": attempt === 1 ? "bytes 0-1/4" : "bytes 1-2/4", etag: '"entry"' });
    response.write("x"); response.end();
  });
  const client = fixture.transport();
  await assert.rejects(client.getObjectStream!({ ...key, Range: "bytes=1-2" }), { code: "InvalidResponse" });
  const output = await client.getObjectStream!({ ...key, Range: "bytes=1-2" });
  await assert.rejects(bodyBytes(output.Body), { code: "InvalidResponse" });
});

test("premature response closure never becomes successful bytes", async context => {
  const fixture = await serverFor(context, (_request, response) => {
    response.writeHead(200, { "content-length": "10" });
    response.write("short");
    setTimeout(() => response.destroy(), 5);
  });
  await assert.rejects(fixture.transport().getObject(key));
});

test("XML byte limits also apply to HTTP error and COPY bodies", async context => {
  const fixture = await serverFor(context, (request, response) => {
    if (request.method === "GET") response.writeHead(403);
    response.end("x".repeat(1024));
  });
  const client = fixture.transport({ maxXmlBytes: 128 });
  await assert.rejects(client.getObject(key), { code: "EntityTooLarge" });
  await assert.rejects(client.copyObject({ ...key, CopySource: "testbucket/source" }), { code: "EntityTooLarge" });
});

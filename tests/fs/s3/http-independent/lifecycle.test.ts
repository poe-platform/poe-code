import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createTcpServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createS3HttpTransport } from "../../../../src/fs/s3/http/index.js";
import { credentials, digest, fixture, metadata, object } from "./helpers.js";

test("credential-provider deadline rejects and observes a late rejection without requesting", async context => {
  let requests = 0, rejectLate!: (error: Error) => void;
  const server = await fixture(context, (_request, response) => { requests++; response.end(); });
  const pending = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
  await assert.rejects(server.transport({ requestTimeoutMs: 30, credentials: () => pending }).headObject(object), { code: "RequestTimeout" });
  rejectLate(new Error("late credential failure")); await delay(0); assert.equal(requests, 0);
});

test("pre-abort preserves the exact caller reason before credential acquisition", async context => {
  let credentialsCalled = 0, requests = 0;
  const controller = new AbortController(), reason = Object.assign(new Error("caller cancellation"), { code: "EIO" });
  controller.abort(reason);
  const server = await fixture(context, (_request, response) => { requests++; response.end(); });
  await assert.rejects(server.transport({ credentials: async () => { credentialsCalled++; return credentials; } }).getObject(object, { abortSignal: controller.signal }), error => error === reason);
  assert.equal(credentialsCalled, 0); assert.equal(requests, 0);
});

test("abort after headers preserves caller identity and closes an outstanding body", async context => {
  let closed!: () => void;
  const connectionClosed = new Promise<void>(resolve => { closed = resolve; });
  const server = await fixture(context, (_request, response) => {
    response.writeHead(200, { etag: '"one"' }); response.write("a"); response.on("close", closed);
  });
  const controller = new AbortController(), reason = new Error("stop pending body");
  const output = await server.transport().getObjectStream!(object, { abortSignal: controller.signal });
  const iterator = output.Body[Symbol.asyncIterator]();
  assert.equal(Buffer.from((await iterator.next()).value!).toString(), "a");
  const next = iterator.next(), rejected = assert.rejects(next, error => error === reason);
  controller.abort(reason); await rejected; await connectionClosed;
});

test("abandoned complete GET still reaches its operation deadline", async context => {
  const bytes = Buffer.from("abcd");
  const server = await fixture(context, (_request, response) => { metadata(response, bytes); response.end(bytes); });
  const output = await server.transport({ requestTimeoutMs: 40 }).getObjectStream!(object);
  await delay(100);
  await assert.rejects(output.Body[Symbol.asyncIterator]().next(), { code: "RequestTimeout" });
});

test("early stream return closes the socket even before its first read", async context => {
  let closed!: () => void;
  const connectionClosed = new Promise<void>(resolve => { closed = resolve; });
  const server = await fixture(context, (_request, response) => { response.writeHead(200, { etag: '"one"' }); response.write("a"); response.on("close", closed); });
  const output = await server.transport().getObjectStream!(object);
  await output.Body[Symbol.asyncIterator]().return!(); await connectionClosed;
});

for (const declared of [true, false]) test(`GET quota applies with content-length=${declared}`, async context => {
  const server = await fixture(context, (_request, response) => {
    if (declared) metadata(response, Buffer.alloc(5)); response.end("12345");
  });
  await assert.rejects(server.transport({ maxGetBytes: 4 }).getObject(object), { code: "EntityTooLarge" });
});

test("binary streaming produces exact bytes and does not share yielded chunk ownership", async context => {
  const bytes = Buffer.alloc(1024 * 1024); for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 37 + 11) & 255;
  const server = await fixture(context, (_request, response) => { metadata(response, bytes); response.end(bytes); });
  const output = await server.transport({ maxGetBytes: bytes.length }).getObjectStream!(object);
  const chunks: Buffer[] = [];
  for await (const chunk of output.Body) { chunks.push(Buffer.from(chunk)); chunk.fill(0); }
  assert.equal(digest(Buffer.concat(chunks)), digest(bytes));
  assert.throws(() => output.Body[Symbol.asyncIterator](), { code: "InvalidResponse" });
});

for (const [range, contentRange, expected] of [
  ["bytes=0-0", "bytes 0-0/4", "a"], ["bytes=2-", "bytes 2-3/4", "cd"],
  ["bytes=-2", "bytes 2-3/4", "cd"], ["bytes=0-99", "bytes 0-3/4", "abcd"],
] as const) test(`actual range response: ${range}`, async context => {
  const server = await fixture(context, (request, response) => {
    assert.equal(request.headers.range, range); response.statusCode = 206; response.setHeader("content-range", contentRange); metadata(response, Buffer.from(expected)); response.end(expected);
  });
  const output = await server.transport().getObjectStream!({ ...object, Range: range });
  const chunks: Buffer[] = []; for await (const chunk of output.Body) chunks.push(Buffer.from(chunk)); assert.equal(Buffer.concat(chunks).toString(), expected);
});

for (const [name, status, contentRange] of [["ignored range", 200, "bytes 0-1/4"], ["wrong offset", 206, "bytes 1-2/4"], ["bad total", 206, "bytes 0-1/1"]] as const) test(`rejects ${name}`, async context => {
  const server = await fixture(context, (_request, response) => { response.statusCode = status; response.setHeader("content-range", contentRange); metadata(response, Buffer.from("ab")); response.end("ab"); });
  await assert.rejects(server.transport().getObjectStream!({ ...object, Range: "bytes=0-1" }), { code: "InvalidResponse" });
});

test("premature HTTP body never returns buffered success", async context => {
  const server = createTcpServer(socket => { socket.once("data", () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 5\r\nETag: "one"\r\nConnection: close\r\n\r\nabc')); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  context.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const transport = createS3HttpTransport({ endpoint: `http://127.0.0.1:${address.port}`, region: "us-east-1", credentials, allowInsecureHttp: true, requestTimeoutMs: 500 });
  await assert.rejects(transport.getObject(object));
});

test("response header limit rejects an oversized native header block", async context => {
  const server = await fixture(context, (_request, response) => { response.setHeader("x-untrusted", "x".repeat(17000)); response.end("ok"); });
  await assert.rejects(server.transport().getObject(object), { code: "HPE_HEADER_OVERFLOW" });
});

for (const status of [200, 500]) test(`XML response quota applies at status${status}`, async context => {
  const server = await fixture(context, (_request, response) => { response.statusCode = status; response.end("x".repeat(65)); });
  await assert.rejects(server.transport({ maxXmlBytes: 64 }).listObjectsV2({ Bucket: object.Bucket }), { code: "EntityTooLarge" });
});

for (const failure of ["source too large", "source ETag changed", "caller abort"]) test(`guarded COPY never publishes after ${failure}`, async context => {
  const methods: string[] = [];
  const controller = new AbortController(), reason = new Error("stop copy before destination");
  const server = await fixture(context, (request, response) => {
    methods.push(request.method!); assert.equal(request.method, "GET");
    if (failure === "caller abort") { response.writeHead(200, { etag: '"one"', "content-length": "5" }); response.write("a"); controller.abort(reason); return; }
    metadata(response, Buffer.from("12345"), failure === "source ETag changed" ? '"changed"' : '"one"'); response.end("12345");
  });
  const transport = server.transport({ enableCopy: false, verifiedConditionalOperations: { put: true }, maxPutBytes: failure === "source too large" ? 4 : 20 });
  await assert.rejects(transport.copyObject({ ...object, CopySource: "/review-bucket/source", CopySourceIfMatch: '"one"', IfNoneMatch: "*" }, { abortSignal: controller.signal }), error => failure === "caller abort" ? error === reason : ["EntityTooLarge", "InvalidResponse", "PreconditionFailed"].includes((error as { code: string }).code));
  assert.deepEqual(methods, ["GET"]);
});

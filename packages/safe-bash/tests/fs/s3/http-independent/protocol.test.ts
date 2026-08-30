import assert from "node:assert/strict";
import { request as nativeRequest } from "node:http";
import test from "node:test";
import { createS3HttpTransport } from "../../../../src/fs/s3/http/index.js";
import { body, copy, credentials, fixture, list, metadata, object, verifyWire } from "./helpers.js";

for (const [key, path] of [
  ["a/../b", "a/../b"], ["a/./b", "a/./b"], ["a//b/", "a//b/"], ["/a", "/a"],
  ["%2e/%2F", "%252e/%252F"], ["雪 é", "%E9%9B%AA%20%C3%A9"], ["e\u0301", "e%CC%81"],
  ["+?#&=", "%2B%3F%23%26%3D"], ["!'()*", "%21%27%28%29%2A"], ["line\nname", "line%0Aname"],
  ["zero\0name", "zero%00name"], ["back\\slash", "back%5Cslash"], ["..x/.../x.", "..x/.../x."],
] as const) test(`independent raw signed object target: ${JSON.stringify(key)}`, async context => {
  const bytes = Buffer.from([0, 255, 128, 10]);
  const server = await fixture(context, async (request, response) => {
    const received = await body(request); verifyWire(request, received);
    assert.equal(request.url, `/review-bucket/${path}`); assert.deepEqual(received, bytes);
    response.setHeader("etag", '"written"'); response.end();
  });
  const result = await server.transport().putObject({ ...object, Key: key, Body: bytes });
  assert.equal((result as { ETag: string }).ETag, '"written"');
});

test("independent query encoding and opaque token stay exact on wire", async context => {
  const server = await fixture(context, async (request, response) => {
    verifyWire(request, await body(request));
    assert.equal(request.url, "/review-bucket?continuation-token=a%2B%2F%3D%252F%20%3F&delimiter=%2F&encoding-type=url&list-type=2&max-keys=2&prefix=%E9%9B%AA%20%2B%25");
    response.end(list);
  });
  await server.transport().listObjectsV2({ Bucket: object.Bucket, Prefix: "雪 +%", Delimiter: "/", MaxKeys: 2, ContinuationToken: "a+/=%2F ?" });
});

test("independent session token and trusted explicit connection routing", async context => {
  const server = await fixture(context, async (request, response) => {
    verifyWire(request, await body(request));
    assert.equal(request.headers.host, `review-bucket.namespace.invalid:${server.port}`);
    assert.equal(request.url, "/a/../%25"); assert.equal(request.headers["x-amz-security-token"], "session/+==");
    metadata(response, Buffer.from("ok")); response.end("ok");
  });
  const transport = server.transport({ endpoint: `http://namespace.invalid:${server.port}`, addressingStyle: "virtual-hosted",
    credentials: { ...credentials, sessionToken: "session/+==" },
    request: (options, callback) => { assert.equal(options.hostname, "review-bucket.namespace.invalid"); return nativeRequest({ ...options, hostname: "127.0.0.1" }, callback); },
  });
  assert.deepEqual((await transport.getObject({ ...object, Key: "a/../%" })).Body, Buffer.from("ok"));
});

test("independent PUT snapshots reused bytes before awaiting credentials", async context => {
  const bytes = Buffer.from([1, 2, 3, 4]);
  const server = await fixture(context, async (request, response) => {
    const received = await body(request); verifyWire(request, received); assert.deepEqual(received, Buffer.from([1, 2, 3, 4])); response.end();
  });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const pending = server.transport({ credentials: async () => { await waiting; return credentials; } }).putObject({ ...object, Body: bytes });
  bytes.fill(9); release(); await pending;
});

for (const endpoint of ["http://127.0.0.1\\unexpected", "https://example.invalid\\@path"]) test(`endpoint origin validation rejects normalized path: ${endpoint}`, () => {
  assert.throws(() => createS3HttpTransport({ endpoint, region: "us-east-1", credentials, allowInsecureHttp: true }), { code: "InvalidArgument" });
});

for (const status of [301, 302, 303, 307, 308]) test(`redirect${status} never forwards credentials`, async context => {
  let targetRequests = 0, originalRequests = 0;
  const target = await fixture(context, (_request, response) => { targetRequests++; response.end(); });
  const original = await fixture(context, (_request, response) => { originalRequests++; response.writeHead(status, { location: target.endpoint + "/leak" }); response.end(); });
  await assert.rejects(original.transport().getObject(object), { code: "RedirectRejected" });
  assert.equal(originalRequests, 1); assert.equal(targetRequests, 0);
});

for (const [name, xml] of [
  ["embedded error", "<Error><Code>AccessDenied</Code><Message>late refusal</Message></Error>"],
  ["malformed XML", "<CopyObjectResult><ETag>broken</CopyObjectResult>"],
  ["duplicate ETag", '<CopyObjectResult><ETag>"one"</ETag><ETag>"two"</ETag><LastModified>2026-08-27T00:00:00Z</LastModified></CopyObjectResult>'],
  ["invalid UTF8", Buffer.from([255])],
] as const) test(`COPY complete HTTP200 ${name} cannot become success`, async context => {
  const server = await fixture(context, (_request, response) => response.end(xml));
  await assert.rejects(server.transport().copyObject({ ...object, CopySource: "/review-bucket/source" }), { code: name === "embedded error" ? "AccessDenied" : "InvalidResponse" });
});

for (const xml of ["<!--invalid--->" + copy, copy + "<!--invalid--->"]) test(`invalid XML comment is rejected: ${xml.startsWith("<!--") ? "before" : "after"}`, async context => {
  const server = await fixture(context, (_request, response) => response.end(xml));
  await assert.rejects(server.transport().copyObject({ ...object, CopySource: "/review-bucket/source" }), { code: "InvalidResponse" });
});

test("valid empty comments and single internal hyphens remain accepted", async context => {
  const server = await fixture(context, (_request, response) => response.end("<!----><!--valid- comment-->" + copy + "<!---->"));
  const result = await server.transport().copyObject({ ...object, CopySource: "/review-bucket/source" });
  assert.equal(result.CopyObjectResult?.ETag, '"copy"');
});

for (const [encoding, key, expected] of [["percent", "a+b%252F", "a+b%2F"], ["form", "a+b%252F", "a b%2F"]] as const) test(`LIST ${encoding} decoding is one pass and token is opaque`, async context => {
  const server = await fixture(context, (_request, response) => response.end(`<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated><NextContinuationToken>a+%2F=</NextContinuationToken><Contents><Key>${key}</Key><Size>0</Size><ETag>"one"</ETag><LastModified>2026-08-27T00:00:00Z</LastModified></Contents></ListBucketResult>`));
  const output = await server.transport({ listUrlEncoding: encoding }).listObjectsV2({ Bucket: object.Bucket });
  assert.equal(output.Contents?.[0]?.Key, expected); assert.equal(output.NextContinuationToken, "a+%2F=");
});

for (const [name, xml] of [
  ["missing token", "<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>"],
  ["duplicate truncation", "<ListBucketResult><IsTruncated>false</IsTruncated><IsTruncated>true</IsTruncated></ListBucketResult>"],
  ["invalid percent", '<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated><Contents><Key>%FF</Key><Size>0</Size><ETag>"one"</ETag><LastModified>2026-08-27T00:00:00Z</LastModified></Contents></ListBucketResult>'],
  ["external entity", '<!DOCTYPE ListBucketResult [<!ENTITY stolen SYSTEM "file:///never-read">]><ListBucketResult>&stolen;</ListBucketResult>'],
  ["unsafe integer", "<ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>9007199254740992</KeyCount></ListBucketResult>"],
] as const) test(`LIST fails closed: ${name}`, async context => {
  const server = await fixture(context, (_request, response) => response.end(xml));
  await assert.rejects(server.transport().listObjectsV2({ Bucket: object.Bucket }), { code: "InvalidResponse" });
});

test("conditional capability configuration is not inferred from successful headers", async context => {
  let calls = 0;
  const server = await fixture(context, (_request, response) => { calls++; response.setHeader("etag", '"one"'); response.end(); });
  const transport = server.transport();
  await transport.putObject({ ...object, Body: Buffer.from("ok") });
  assert.equal(transport.capabilities?.conditionalPut, false); assert.equal(transport.capabilities?.streamingWrite, false); assert.equal(transport.putObjectStream, undefined);
  await assert.rejects(transport.putObject({ ...object, Body: Buffer.from("bad"), IfMatch: '"one"' }), { code: "NotImplemented" });
  await assert.rejects(transport.copyObject({ ...object, CopySource: "/review-bucket/source", CopySourceIfMatch: '"one"' }), { code: "NotImplemented" });
  await assert.rejects(transport.deleteObject({ ...object, IfMatch: '"one"' }), { code: "NotImplemented" });
  assert.equal(calls, 1);
});

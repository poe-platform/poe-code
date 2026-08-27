import assert from "node:assert/strict";
import { request as nodeRequest } from "node:http";
import test from "node:test";
import { createS3HttpTransport } from "../../../../../src/fs/s3/http/index.js";
import { encodeCopySource } from "../../../../../src/fs/s3/transport.js";
import { bodyBytes, clock, copyResult, credentials, date, key, serverFor, verifySignature } from "./helpers.js";

test("real TCP wire preserves dot segments, repeated slashes, UTF-8 and literal percent keys", async context => {
  const paths = ["a/../b", "./a", "../a", "a//b", "a/%2E%2E/b", "雪 +?#!'()*", "/leading/"];
  const expected = ["a/../b", "./a", "../a", "a//b", "a/%252E%252E/b", "%E9%9B%AA%20%2B%3F%23%21%27%28%29%2A", "/leading/"];
  const seen: string[] = [];
  const fixture = await serverFor(context, (request, response) => {
    seen.push(request.url!);
    response.writeHead(200, { "content-length": "3", etag: '"opaque"' });
    response.end(Buffer.from([0, 128, 255]));
  });
  for (const path of paths) assert.deepEqual((await fixture.transport().getObject({ ...key, Key: path })).Body, Buffer.from([0, 128, 255]));
  assert.deepEqual(seen, expected.map(path => `/testbucket/${path}`));
});

test("HEAD metadata, buffered PUT snapshot, DELETE and header signing use real sockets", async context => {
  const seen: string[] = [];
  const fixture = await serverFor(context, (request, response, body) => {
    seen.push(request.method!);
    if (request.method === "PUT") {
      assert.deepEqual(body, Buffer.from([1, 2, 3]));
      assert.equal(request.headers["x-amz-meta-note"], "one two");
      assert.equal(request.headers["if-none-match"], "*");
      response.writeHead(200, { etag: '"new"' });
    } else if (request.method === "HEAD") response.writeHead(200, { "content-length": "3", "last-modified": new Date(date).toUTCString(), etag: '"new"', "x-amz-meta-note": "one two" });
    else { assert.equal(request.headers["if-match"], '"new"'); response.writeHead(204); }
    response.end();
  });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const client = fixture.transport({ credentials: async ({ signal }) => { assert.equal(signal.aborted, false); await wait; return credentials; }, verifiedConditionalOperations: { put: true, delete: true } });
  const bytes = Buffer.from([1, 2, 3]);
  const pending = client.putObject({ ...key, Body: bytes, IfNoneMatch: "*", Metadata: { NOTE: "  one \t two  " } });
  bytes.fill(9);
  release();
  await pending;
  const metadata = await client.headObject(key);
  assert.equal(metadata.ContentLength, 3);
  assert.equal(metadata.ETag, '"new"');
  assert.equal(metadata.Metadata?.note, "one two");
  assert.equal(metadata.LastModified?.toISOString(), date);
  await client.deleteObject({ ...key, IfMatch: '"new"' });
  assert.deepEqual(seen, ["PUT", "HEAD", "DELETE"]);
});

test("COPY preserves already encoded source and separates source/destination conditions", async context => {
  const source = encodeCopySource("testbucket", "雪 /literal%2F/../source");
  const fixture = await serverFor(context, (request, response, body) => {
    assert.equal(request.headers["x-amz-copy-source"], source);
    assert.equal(request.headers["x-amz-copy-source-if-match"], '"source"');
    assert.equal(request.headers["if-match"], '"destination"');
    assert.equal(request.headers["if-none-match"], "*");
    assert.equal(request.headers["x-amz-metadata-directive"], "REPLACE");
    assert.equal(body.length, 0);
    response.end(copyResult());
  });
  const result = await fixture.transport({ verifiedConditionalOperations: { copy: true } }).copyObject({ ...key,
    CopySource: source, CopySourceIfMatch: '"source"', IfMatch: '"destination"', IfNoneMatch: "*", MetadataDirective: "REPLACE", Metadata: { mode: "384" } });
  assert.equal(result.CopyObjectResult?.ETag, '"copied"');
});

test("LIST encodes sorted queries and decodes URL keys once, never continuation tokens", async context => {
  const fixture = await serverFor(context, (request, response) => {
    assert.equal(request.url, "/testbucket?continuation-token=a%2B%2F%3D%252F&delimiter=%2F&encoding-type=url&list-type=2&max-keys=2&prefix=%E9%9B%AA%20");
    response.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated><KeyCount>2</KeyCount><NextContinuationToken>x+/%2F&amp;=</NextContinuationToken><Contents><Key>%E9%9B%AA%20%252F</Key><Size>3</Size><ETag>&quot;entry&quot;</ETag><LastModified>${date}</LastModified></Contents><CommonPrefixes><Prefix>%E9%9B%AA%20folder%2F</Prefix></CommonPrefixes></ListBucketResult>`);
  });
  const result = await fixture.transport().listObjectsV2({ Bucket: "testbucket", Prefix: "雪 ", Delimiter: "/", MaxKeys: 2, ContinuationToken: "a+/=%2F" });
  assert.equal(result.Contents?.[0]?.Key, "雪 %2F");
  assert.equal(result.CommonPrefixes?.[0]?.Prefix, "雪 folder/");
  assert.equal(result.NextContinuationToken, "x+/%2F&=");
  assert.equal(result.IsTruncated, true);
});

test("streamed GET preserves binary bytes and validates ranges and IfMatch", async context => {
  const fixture = await serverFor(context, (request, response) => {
    assert.equal(request.headers.range, "bytes=1-2");
    assert.equal(request.headers["if-match"], '"entry"');
    response.writeHead(206, { "content-range": "bytes 1-2/4", "content-length": "2", etag: '"entry"' });
    response.write(Buffer.from([128])); response.end(Buffer.from([255]));
  });
  const output = await fixture.transport().getObjectStream!({ ...key, Range: "bytes=1-2", IfMatch: '"entry"' });
  assert.deepEqual(await bodyBytes(output.Body), Buffer.from([128, 255]));
});

test("explicit session credentials and request factory preserve signed Host and raw target", async context => {
  const fixture = await serverFor(context, (request, response, bytes) => { verifySignature(request, bytes, "token/+=" ); response.end("value"); }, false);
  let calls = 0;
  const client = fixture.transport({ credentials: { ...credentials, sessionToken: "token/+=" }, request(options, callback) {
    calls++;
    assert.equal(options.path, "/testbucket/a/../b");
    assert.equal(options.agent, false);
    return nodeRequest(options, callback);
  } });
  assert.deepEqual((await client.getObject({ ...key, Key: "a/../b" })).Body, Buffer.from("value"));
  assert.equal(calls, 1);
});

test("conditional capabilities default false and reject guarded mutations before requests", async context => {
  const fixture = await serverFor(context, (_request, response) => { response.end(); });
  const client = fixture.transport();
  assert.deepEqual(client.capabilities, { streamingRead: true, streamingWrite: false, conditionalPut: false, conditionalCopy: false, conditionalDelete: false });
  assert.equal(client.putObjectStream, undefined);
  await assert.rejects(client.putObject({ ...key, Body: new Uint8Array(), IfNoneMatch: "*" }), { code: "NotImplemented" });
  await assert.rejects(client.putObject({ ...key, Body: new Uint8Array(), IfMatch: '"old"' }), { code: "NotImplemented" });
  await assert.rejects(client.copyObject({ ...key, CopySource: "testbucket/source", CopySourceIfMatch: '"old"' }), { code: "NotImplemented" });
  await assert.rejects(client.deleteObject({ ...key, IfMatch: '"old"' }), { code: "NotImplemented" });
  const noCopy = fixture.transport({ enableCopy: false, verifiedConditionalOperations: { copy: true, delete: true } });
  assert.equal(noCopy.capabilities?.conditionalCopy, false);
  await assert.rejects(noCopy.copyObject({ ...key, CopySource: "testbucket/source" }), { code: "NotImplemented" });
  assert.equal(fixture.requests(), 0);
});

test("effective COPY capability is native-verified or guarded-fallback-verified, never DELETE", async context => {
  const fixture = await serverFor(context, (_request, response) => { response.end(); });
  for (const [enableCopy, put, copy, expected] of [[true, true, false, false], [true, false, true, true],
    [false, true, false, true], [false, false, true, false], [false, false, false, false]] as const) {
    const client = fixture.transport({ enableCopy, verifiedConditionalOperations: { put, copy, delete: false } });
    assert.equal(client.capabilities?.conditionalCopy, expected);
    assert.equal(client.capabilities?.conditionalDelete, false);
  }
  assert.equal(fixture.requests(), 0);
});

test("configuration, headers, keys and upload bounds reject before network", async context => {
  const fixture = await serverFor(context, (_request, response) => { response.end(); });
  for (const endpoint of ["https://user:secret@example.com", "https://example.com/a/..", "https://example.com?query", "https://example.com#hash", "file:///tmp/file"]) {
    assert.throws(() => createS3HttpTransport({ endpoint, region: "us-east-1", credentials }), { code: "InvalidArgument" });
  }
  assert.throws(() => createS3HttpTransport({ endpoint: fixture.endpoint, region: "us-east-1", credentials }), { code: "InvalidArgument" });
  const client = fixture.transport({ maxPutBytes: 2 });
  await assert.rejects(client.putObject({ ...key, Body: Buffer.from("big") }), { code: "EntityTooLarge" });
  await assert.rejects(client.putObject({ ...key, Body: new Uint8Array(), Metadata: { value: "bad\r\nheader" } }), { code: "InvalidArgument" });
  await assert.rejects(client.getObject({ ...key, Key: "\ud800" }), { code: "InvalidArgument" });
  await assert.rejects(client.getObject({ ...key, Bucket: "../escape" }), { code: "InvalidArgument" });
  await assert.rejects(client.listObjectsV2({ Bucket: key.Bucket, MaxKeys: 1001 }), { code: "InvalidArgument" });
  assert.equal(fixture.requests(), 0);
  assert.equal(clock().toISOString(), date);
});

for (const encoding of ["percent", "form"] as const) test(`explicit ${encoding} LIST decoder preserves space, plus, percent and tokens`, async context => {
  let iteration = 0;
  const fixture = await serverFor(context, (_request, response) => {
    iteration++;
    response.end(`<ListBucketResult>${iteration === 1 ? "<EncodingType>url</EncodingType>" : ""}<IsTruncated>true</IsTruncated><NextContinuationToken>a+%2B%25</NextContinuationToken><CommonPrefixes><Prefix>space+%2B%25/</Prefix></CommonPrefixes></ListBucketResult>`);
  });
  const client = fixture.transport({ listUrlEncoding: encoding });
  const encoded = await client.listObjectsV2({ Bucket: "testbucket" });
  assert.equal(encoded.CommonPrefixes?.[0]?.Prefix, encoding === "form" ? "space +%/" : "space++%/");
  assert.equal(encoded.NextContinuationToken, "a+%2B%25");
  const unencoded = await client.listObjectsV2({ Bucket: "testbucket" });
  assert.equal(unencoded.CommonPrefixes?.[0]?.Prefix, "space+%2B%25/");
});

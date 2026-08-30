import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import test, { type TestContext } from "node:test";
import { createS3HttpTransport } from "../../../../../../src/fs/s3/http/index.js";

const credentials = { accessKeyId: "final-protocol-fixture", secretAccessKey: "synthetic-no-service-secret" };
const options = { region: "us-east-1", credentials, allowInsecureHttp: true, requestTimeoutMs: 1000 };
const object = { Bucket: "final-protocol", Key: "destination", CopySource: "/final-protocol/source" };
const modified = "2026-08-27T00:00:00Z";
const resultXml = (etag = '"neighbor"') => `<CopyObjectResult><ETag>${etag}</ETag><LastModified>${modified}</LastModified></CopyObjectResult>`;

async function rawFixture(context: TestContext, xml: string) {
  const requests: string[] = [];
  const errors: Error[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("error", error => errors.push(error));
    socket.on("close", () => sockets.delete(socket));
    let bytes = Buffer.alloc(0);
    let answered = false;
    socket.on("data", chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (answered || !bytes.includes("\r\n\r\n")) return;
      answered = true;
      requests.push(bytes.toString("latin1"));
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\nContent-Length: ${Buffer.byteLength(xml)}\r\nConnection: close\r\n\r\n${xml}`);
    });
  });
  server.on("error", error => errors.push(error));
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.deepEqual(errors, []);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { endpoint: `http://127.0.0.1:${address.port}`, requests };
}

for (const endpoint of [
  "https://example.invalid", "https://example.invalid/", "http://localhost:9000",
  "http://[::1]:9000/", "https://EXAMPLE.invalid:443", "https://%65xample.invalid",
]) test(`neighbor valid configured origin ${endpoint}`, { timeout: 5000 }, () => {
  let calls = 0;
  const transport = createS3HttpTransport({ ...options, endpoint, request: () => { calls++; throw new Error("unexpected I/O"); } });
  assert.equal(typeof transport.copyObject, "function");
  assert.equal(calls, 0);
});

for (const endpoint of [
  "https://example.invalid\\", "https://example.invalid\\hidden", "https://example.invalid\\@other.invalid",
  "http://[::1]\\hidden", "https://example.invalid/%5C", "https://example.invalid/%2F",
  "https://example.invalid%5Cother.invalid", "https://example.invalid%2Fother.invalid",
  "https://user:secret@example.invalid/", "https://example.invalid/path",
]) test(`neighbor invalid configured origin ${endpoint}`, { timeout: 5000 }, () => {
  let calls = 0;
  assert.throws(() => createS3HttpTransport({ ...options, endpoint, request: () => { calls++; throw new Error("unexpected I/O"); } }), { code: "InvalidArgument" });
  assert.equal(calls, 0);
});

for (const [key, expected] of [
  ["\\@other.invalid/a", "%5C%40other.invalid/a"],
  ["%5C/%2F/%252F", "%255C/%252F/%25252F"],
  ["a\\/../b//", "a%5C/../b//"],
  ["//%2e/./tail", "//%252e/./tail"],
  ["a%/é?+", "a%25/%C3%A9%3F%2B"],
] as const) test(`neighbor exact raw TCP request target ${JSON.stringify(key)}`, { timeout: 5000 }, async context => {
  const fixture = await rawFixture(context, resultXml());
  const transport = createS3HttpTransport({ ...options, endpoint: fixture.endpoint + "/" });
  await transport.copyObject({ ...object, Key: key });
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0]!.split("\r\n")[0], `PUT /final-protocol/${expected} HTTP/1.1`);
  assert.match(fixture.requests[0]!, /\r\nhost: 127\.0\.0\.1:\d+\r\n/i);
});

for (const [name, xml, expected] of [
  ["empty comments surround root", `<!---->${resultXml()}<!---->`, '"neighbor"'],
  ["single hyphen followed by space", `<!--- -->${resultXml()}<!--a-b-->`, '"neighbor"'],
  ["comment ignores entity-looking data", `<!--&notAnEntity; < > ]]>-->${resultXml()}`, '"neighbor"'],
  ["comment between scalar elements", resultXml().replace("</ETag>", "</ETag><!--a-b-->"), '"neighbor"'],
  ["empty comment inside scalar", resultXml('"neigh<!---->bor"'), '"neighbor"'],
  ["single hyphen comment inside scalar", resultXml('"neigh<!--a-b-->bor"'), '"neighbor"'],
  ["CDATA containing malformed-looking comment", resultXml('<![CDATA["<!--invalid--->"]]>'), '"<!--invalid--->"'],
  ["text/comment/CDATA boundaries", resultXml('&quot;neigh<!--a-b--><![CDATA[bor]]>&quot;'), '"neighbor"'],
  ["hyphens are legal ordinary text", resultXml('"a---b"'), '"a---b"'],
  ["escaped malformed-looking comment is text", resultXml('&quot;&lt;!--invalid---&gt;&quot;'), '"<!--invalid--->"'],
  ["declaration then comments", `<?xml version="1.0" encoding="UTF-8"?><!---->${resultXml()}<!--a-b-->`, '"neighbor"'],
] as const) test(`neighbor valid XML ${name}`, { timeout: 5000 }, async context => {
  const fixture = await rawFixture(context, xml);
  const transport = createS3HttpTransport({ ...options, endpoint: fixture.endpoint });
  const result = await transport.copyObject(object);
  assert.equal(result.CopyObjectResult?.ETag, expected);
  assert.equal(result.CopyObjectResult?.LastModified?.toISOString(), modified.replace("Z", ".000Z"));
  assert.equal(fixture.requests.length, 1);
});

for (const [name, comment] of [
  ["trailing hyphen", "<!--x--->"], ["double internal hyphen", "<!--x--y-->"], ["unterminated comment", "<!--x"],
] as const) for (const position of ["before", "inside", "after"] as const) test(`neighbor malformed ${name} ${position} result`, { timeout: 5000 }, async context => {
  const xml = position === "before" ? comment + resultXml() : position === "after" ? resultXml() + comment : resultXml().replace("<ETag>", comment + "<ETag>");
  const fixture = await rawFixture(context, xml);
  const transport = createS3HttpTransport({ ...options, endpoint: fixture.endpoint });
  await assert.rejects(transport.copyObject(object), { code: "InvalidResponse" });
  assert.equal(fixture.requests.length, 1);
});

for (const [name, etag] of [
  ["unescaped CDATA closer in text", '"a]]>b"'],
  ["trailing hyphen comment within scalar", '"a<!--x--->b"'],
] as const) test(`neighbor invalid XML boundary ${name}`, { timeout: 5000 }, async context => {
  const fixture = await rawFixture(context, resultXml(etag));
  await assert.rejects(createS3HttpTransport({ ...options, endpoint: fixture.endpoint }).copyObject(object), { code: "InvalidResponse" });
});

for (const [name, xml] of [
  ["ordinary comments", '<!----><Error><!--inside--><Code>AccessDenied</Code><Message>late &amp; exact refusal</Message></Error><!--after-->'],
  ["scalar comment boundaries", '<Error><Code>Access<!--safe-->Denied</Code><Message>late &amp; exact<!----> refusal</Message></Error>'],
  ["CDATA message", '<Error><Code><![CDATA[AccessDenied]]></Code><Message><![CDATA[late & exact refusal]]></Message></Error>'],
] as const) test(`neighbor COPY HTTP200 Error preserves code/message/status ${name}`, { timeout: 5000 }, async context => {
  const fixture = await rawFixture(context, xml);
  await assert.rejects(createS3HttpTransport({ ...options, endpoint: fixture.endpoint }).copyObject(object), { code: "AccessDenied", message: "late & exact refusal", $metadata: { httpStatusCode: 200 } });
  assert.equal(fixture.requests.length, 1);
});

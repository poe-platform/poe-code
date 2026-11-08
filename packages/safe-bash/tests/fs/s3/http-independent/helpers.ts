import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { TestContext } from "node:test";
import { createS3HttpTransport, type S3HttpTransportOptions } from "../../../../src/fs/s3/http/index.js";

export const credentials = { accessKeyId: "independent-review-key", secretAccessKey: "synthetic-independent-review-secret" };
export const object = { Bucket: "review-bucket", Key: "item" };
export const modified = "Thu, 27 Aug 2026 00:00:00 GMT";
export const list = "<ListBucketResult><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>";
export const copy = '<CopyObjectResult><LastModified>2026-08-27T00:00:00Z</LastModified><ETag>"copy"</ETag></CopyObjectResult>';
export const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export async function body(message: IncomingMessage): Promise<Buffer> {
  const pieces: Buffer[] = [];
  for await (const piece of message) pieces.push(Buffer.from(piece));
  return Buffer.concat(pieces);
}
export async function fixture(context: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => unknown) {
  const errors: unknown[] = [];
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(error => { errors.push(error); response.destroy(); });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  context.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); assert.deepEqual(errors, []); });
  const endpoint = `http://127.0.0.1:${address.port}`;
  return { server, endpoint, port: address.port,
    transport: (overrides: Partial<S3HttpTransportOptions> = {}) => createS3HttpTransport({ endpoint, region: "us-east-1", credentials, allowInsecureHttp: true, requestTimeoutMs: 1000, ...overrides }) };
}
export function verifyWire(request: IncomingMessage, bytes: Uint8Array, secret = credentials.secretAccessKey): void {
  const authorization = request.headers.authorization!;
  const parsed = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(authorization);
  assert.ok(parsed, authorization);
  const names = parsed[3]!.split(";");
  assert.deepEqual(names, [...new Set(names)].sort());
  const target = request.url!, separator = target.indexOf("?");
  const path = separator < 0 ? target : target.slice(0, separator), query = separator < 0 ? "" : target.slice(separator + 1);
  const canonical = [request.method, path, query, names.map(name => `${name}:${String(request.headers[name]).trim().replace(/[\t ]+/g, " ")}\n`).join(""), names.join(";"), digest(bytes)].join("\n");
  assert.equal(request.headers["x-amz-content-sha256"], digest(bytes));
  const scope = parsed[2]!.split("/");
  let key: Buffer = Buffer.from("AWS4" + secret);
  for (const component of scope) key = createHmac("sha256", key).update(component).digest();
  const actual = createHmac("sha256", key).update(`AWS4-HMAC-SHA256\n${request.headers["x-amz-date"]}\n${parsed[2]}\n${digest(canonical)}`).digest("hex");
  assert.equal(actual, parsed[4], "independent on-wire HMAC, not the product signer");
}
export function metadata(response: ServerResponse, bytes: Uint8Array, etag = '"one"'): void {
  response.setHeader("content-length", bytes.length); response.setHeader("last-modified", modified); response.setHeader("etag", etag);
}

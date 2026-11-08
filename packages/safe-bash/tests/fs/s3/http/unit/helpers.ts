import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TestContext } from "node:test";
import { createS3HttpTransport } from "../../../../../src/fs/s3/http/index.js";
import type { S3HttpTransportOptions } from "../../../../../src/fs/s3/http/index.js";

export const credentials = { accessKeyId: "TESTACCESS", secretAccessKey: "local-test-secret-only" };
export const clock = (): Date => new Date("2026-08-27T12:00:00Z");
export const date = "2026-08-27T12:00:00.000Z";
export const key = { Bucket: "testbucket", Key: "key" };

export function verifySignature(request: IncomingMessage, body: Uint8Array, token?: string): void {
  const authorization = request.headers.authorization!;
  const match = /^AWS4-HMAC-SHA256 Credential=TESTACCESS\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(authorization);
  assert.ok(match, authorization);
  const scope = match[1]!;
  const names = match[2]!.split(";");
  assert.deepEqual(names, [...names].sort());
  const [pathname, query = ""] = request.url!.split("?");
  const hash = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
  assert.equal(request.headers["x-amz-content-sha256"], hash(body));
  assert.equal(request.headers["x-amz-security-token"], token);
  const canonical = [request.method, pathname, query,
    names.map(name => `${name}:${request.headers[name]}\n`).join(""), match[2], hash(body)].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", request.headers["x-amz-date"], scope, hash(canonical)].join("\n");
  let signing = Buffer.from(`AWS4${credentials.secretAccessKey}`);
  for (const part of scope.split("/")) signing = createHmac("sha256", signing).update(part).digest();
  assert.equal(match[3], createHmac("sha256", signing).update(stringToSign).digest("hex"));
}

export async function serverFor(context: TestContext, handler: (request: IncomingMessage, response: ServerResponse, body: Uint8Array) => void | Promise<void>, verify = true) {
  const errors: unknown[] = [];
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(chunk as Uint8Array);
      const body = Buffer.concat(chunks);
      if (verify) verifySignature(request, body);
      await handler(request, response, body);
    })().catch(error => { errors.push(error); response.destroy(); });
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.deepEqual(errors, []);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const transport = (options: Partial<S3HttpTransportOptions> = {}) => createS3HttpTransport({ endpoint,
    region: "us-east-1", credentials, clock, allowInsecureHttp: true, ...options });
  return { server, endpoint, transport, requests: () => requests };
}

export async function bodyBytes(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export function copyResult(): string {
  return `<CopyObjectResult><LastModified>${date}</LastModified><ETag>&quot;copied&quot;</ETag></CopyObjectResult>`;
}

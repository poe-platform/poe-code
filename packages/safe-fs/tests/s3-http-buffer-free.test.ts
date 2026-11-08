import assert from "node:assert/strict";
import { test } from "vitest";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createS3HttpTransport } from "../src/fs/s3/http/index.js";
import { collect } from "../src/fs/s3/http/request.js";
import type { WireResponse } from "../src/fs/s3/http/request.js";

test("S3 HTTP collects binary response bytes without global Buffer", async () => {
  let closed = 0;
  const response: WireResponse = {
    message: new EventEmitter() as IncomingMessage,
    body: (async function* () { yield Uint8Array.of(0, 255); yield Uint8Array.of(128, 10); })(),
    close() { closed++; },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  try {
    Object.defineProperty(globalThis, "Buffer", { configurable: true, writable: true, value: undefined });
    assert.deepEqual(Array.from(await collect(response, 4, 4)), [0, 255, 128, 10]);
    assert.equal(closed, 1);
  } finally { Object.defineProperty(globalThis, "Buffer", descriptor); }
});


test("S3 HTTP GET and conditional COPY fallback preserve binary bytes without global Buffer", async () => {
  const binary = Uint8Array.of(0, 255, 128, 10);
  const uploads: Uint8Array[] = [];
  const methods: string[] = [];
  const transport = createS3HttpTransport({
    endpoint: "https://example.invalid", region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    enableCopy: false, verifiedConditionalOperations: { put: true },
    request(options, onResponse) {
      const request = new EventEmitter() as ClientRequest;
      methods.push(String(options.method));
      const chunks: Uint8Array[] = [];
      request.write = ((chunk: Uint8Array) => { chunks.push(new Uint8Array(chunk)); return true; }) as typeof request.write;
      request.destroy = (() => request) as typeof request.destroy;
      request.end = (() => {
        if (options.method === "PUT") uploads.push(...chunks);
        const message = new EventEmitter() as IncomingMessage;
        message.statusCode = 200;
        message.complete = true;
        message.headersDistinct = options.method === "GET"
          ? { "content-length": ["4"], etag: ['"source"'] }
          : { etag: ['"copied"'] };
        message.destroy = (() => message) as typeof message.destroy;
        message[Symbol.asyncIterator] = async function* (): AsyncGenerator<Uint8Array, undefined> { if (options.method === "GET") { yield binary.subarray(0, 2); yield binary.subarray(2); } return undefined; };
        queueMicrotask(() => onResponse(message));
        return request;
      }) as typeof request.end;
      return request;
    },
  });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  try {
    Object.defineProperty(globalThis, "Buffer", { configurable: true, writable: true, value: undefined });
    const result = await transport.getObject({ Bucket: "bucket", Key: "source" });
    assert.ok(result.Body instanceof Uint8Array);
    assert.deepEqual(Array.from(result.Body), Array.from(binary));
    await transport.copyObject({ Bucket: "bucket", Key: "destination", CopySource: "/bucket/source", IfNoneMatch: "*" });
    assert.deepEqual(methods, ["GET", "GET", "PUT"]);
    assert.deepEqual(uploads.map(bytes => Array.from(bytes)), [Array.from(binary)]);
  } finally { Object.defineProperty(globalThis, "Buffer", descriptor); }
});

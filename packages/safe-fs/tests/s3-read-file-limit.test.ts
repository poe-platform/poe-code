import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { expect, test, vi } from "vitest";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { createS3HttpTransport } from "../src/fs/s3/http/transport.js";
import { createS3Transport, MockS3Client } from "../src/fs/s3/index.js";

test("readFile closes an SDK body rejected before its first read", async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  await client.putObject({ Bucket: "bucket", Key: "file", Body: Uint8Array.of(1) });
  let reads = 0;
  const body = new Readable({ read() {
    reads++;
    this.push(new Uint8Array(8));
    this.push(null);
  } });
  const filesystem = new S3FileSystem({ bucket: "bucket", maxReadBytes: 4, transport: {
    ...createS3Transport(client),
    async getObject() { return { Body: body, ContentLength: 8 }; },
  } });
  await expect(filesystem.readFile("/file")).rejects.toMatchObject({ code: "EFBIG" });
  expect(reads).toBe(0);
  expect(body.destroyed).toBe(true);
});

for (const cleanup of ["destroy", "cancel"] as const) {
  test(`readFile calls ${cleanup} once when the rejected body is its own iterator`, async () => {
    const client = new MockS3Client({ buckets: ["bucket"] });
    await client.putObject({ Bucket: "bucket", Key: "file", Body: Uint8Array.of(1) });
    const dispose = vi.fn();
    const next = vi.fn(async () => ({ done: true as const, value: undefined }));
    const body = {
      [Symbol.asyncIterator]() { return this; },
      next,
      [cleanup]: dispose,
    };
    const filesystem = new S3FileSystem({ bucket: "bucket", maxReadBytes: 4, transport: {
      ...createS3Transport(client),
      async getObject() { return { Body: body, ContentLength: 8 }; },
    } });
    await expect(filesystem.readFile("/file")).rejects.toMatchObject({ code: "EFBIG" });
    expect(next).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
}

for (const length of [12, undefined]) {
  test(`readFile bounds a changed HTTP GET with ContentLength ${length}`, async () => {
    let reads = 0;
    let getResponse: Readable | undefined;
    const transport = createS3HttpTransport({
      endpoint: "https://s3.example.invalid",
      region: "test",
      credentials: { accessKeyId: "explicit", secretAccessKey: "explicit-secret" },
      request(options, onResponse) {
        const isGet = options.method === "GET";
        const message = Object.assign(new Readable({
          read() {},
        }), {
          statusCode: options.path?.endsWith("/") ? 404 : 200,
          headersDistinct: options.method === "HEAD" ? { "content-length": ["1"] }
            : length === undefined ? {} : { "content-length": [String(length)] },
          complete: true,
        });
        (message as any)[Symbol.asyncIterator] = async function* () {
          if (isGet) {
            for (let index = 0; index < 3; index++) {
              reads++;
              yield new Uint8Array(4);
            }
          }
        };
        if (isGet) getResponse = message;
        const request = Object.assign(new EventEmitter(), {
          end() { onResponse(message as unknown as IncomingMessage); },
          destroy() {},
        });
        return request as unknown as ClientRequest;
      },
    });
    // Keep namespace lookup deterministic; HEAD and GET use the real HTTP transport.
    const bufferedGet = vi.fn(transport.getObject);
    const filesystem = new S3FileSystem({ bucket: "bucket", transport: {
      ...transport,
      listObjectsV2: async () => ({ Contents: [] }),
      getObject: bufferedGet,
    } });
    await expect(filesystem.readFile("/file", { maxBytes: 5 })).rejects.toMatchObject({ code: "EFBIG" });
    expect(bufferedGet).not.toHaveBeenCalled();
    expect(reads).toBe(length === undefined ? 2 : 0);
    expect(getResponse?.destroyed).toBe(true);
  });
}

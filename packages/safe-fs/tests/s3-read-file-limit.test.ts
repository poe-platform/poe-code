import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { expect, test, vi } from "vitest";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { createS3HttpTransport } from "../src/fs/s3/http/transport.js";

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
        message[Symbol.asyncIterator] = async function* () {
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

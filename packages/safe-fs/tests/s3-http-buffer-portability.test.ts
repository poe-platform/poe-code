import { expect, it, vi } from "vitest";
import { collect, type WireResponse, type RequestScope } from "../src/fs/s3/http/request.js";
import { createS3HttpTransport } from "../src/fs/s3/http/transport.js";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";

const wire = vi.hoisted(() => ({ response: undefined as WireResponse | undefined, bodies: [] as Uint8Array[] }));
vi.mock("../src/fs/s3/http/request.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/fs/s3/http/request.js")>(),
  sendRequest: async (_options: unknown, body: Uint8Array, scope: RequestScope) => {
    wire.bodies.push(new Uint8Array(body));
    const response = wire.response!;
    return { ...response, close() { scope.finish(); response.close(); } };
  },
}));

it("collects HTTP bodies and reads S3 files without a global Buffer", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  const response = (): WireResponse => ({
    message: { statusCode: 200, headersDistinct: { "content-length": ["3"], etag: ['"one"'], "last-modified": ["Wed, 01 Jan 2020 00:00:00 GMT"] } } as WireResponse["message"],
    body: { async *[Symbol.asyncIterator]() { yield Uint8Array.of(0, 255); yield Uint8Array.of(65); } },
    close: vi.fn(),
  });
  const transport = createS3HttpTransport({ endpoint: "https://example.test", region: "us-east-1", enableCopy: false, verifiedConditionalOperations: { put: true }, credentials: { accessKeyId: "test", secretAccessKey: "test" } });
  Reflect.deleteProperty(globalThis, "Buffer");
  try {
    const collected = response();
    expect(await collect(collected, 3, 3)).toEqual(Uint8Array.of(0, 255, 65));
    expect(collected.close).toHaveBeenCalled();
    wire.response = response();
    expect((await transport.getObject({ Bucket: "bucket", Key: "file" })).Body).toEqual(Uint8Array.of(0, 255, 65));
    wire.response = response();
    const fs = new S3FileSystem({ bucket: "bucket", transport: { ...transport, listObjectsV2: async () => ({ Contents: [], CommonPrefixes: [], IsTruncated: false }) } });
    expect(await fs.readFile("/file")).toEqual(Uint8Array.of(0, 255, 65));
    wire.response = response();
    expect(await transport.copyObject!({ Bucket: "bucket", Key: "copy", CopySource: "/bucket/file", IfNoneMatch: "*" })).toMatchObject({ CopyObjectResult: { ETag: '"one"' } });
    expect(wire.bodies.at(-1)).toEqual(Uint8Array.of(0, 255, 65));
  } finally { Object.defineProperty(globalThis, "Buffer", descriptor); }
});

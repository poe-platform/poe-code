import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import {
  FsError,
  MemoryFileSystem,
  MockS3Client,
  ReadOnlyFileSystem,
  S3FileSystem,
  WebDavFileSystem,
  createS3HttpTransport
} from "@poe-code/safe-fs";
import type { WebDavFetch } from "@poe-code/safe-fs";

const properties =
  '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:v="urn:virtual-bash:metadata"><d:response><d:href>/dav/file</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>3</d:getcontentlength><d:getetag>"version"</d:getetag><d:getlastmodified>Thu, 01 Jan 1970 00:00:01 GMT</d:getlastmodified><v:timestamps>{"version":1,"etag":"\\"version\\"","type":"file","atimeMs":2000,"mtimeMs":3000}</v:timestamps></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';

describe("explicit network adapters", () => {
  it("uses only injected WebDAV transport and explicit headers", async () => {
    const fetch = vi.fn<WebDavFetch>(async (_url, init) =>
      init.method === "PROPFIND"
        ? new Response(properties, { status: 207 })
        : new Response(new Uint8Array([0, 128, 255]))
    );
    const filesystem = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch,
      headers: { Authorization: "Bearer explicit" }
    });
    expect(await filesystem.readFile("/file")).toEqual(new Uint8Array([0, 128, 255]));
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe("https://example.invalid/dav/file");
      expect(init).toMatchObject({ redirect: "manual", credentials: "omit" });
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer explicit");
    }
    expect(String(fetch.mock.calls[0]?.[1].body)).toContain("urn:virtual-bash:metadata");
    expect(await filesystem.stat("/file")).toMatchObject({ atimeMs: 2000, mtimeMs: 3000 });
  });

  it("negotiates WebDAV protocol identities through readonly views", async () => {
    const identity =
      '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/file</d:href><d:propstat><d:prop><d:resource-id><d:href>urn:uuid:00000000-0000-0000-0000-000000000001</d:href></d:resource-id></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
    const fetch: WebDavFetch = async (_url, init) =>
      new Response(String(init.body).includes("<d:resource-id/>") ? identity : properties, {
        status: 207
      });
    const left = new WebDavFileSystem({ baseUrl: "https://left.invalid/dav/", fetch });
    const right = new WebDavFileSystem({ baseUrl: "https://right.invalid/dav/", fetch });
    expect(await left.compareEntry("/file", new ReadOnlyFileSystem(right), "/file")).toBe("same");
    const conflicting = new WebDavFileSystem({
      baseUrl: "https://right.invalid/dav/",
      fetch,
      compareEntry: async () => "distinct"
    });
    await expect(left.compareEntry("/file", conflicting, "/file")).rejects.toMatchObject({
      code: "EIO"
    });
  });

  it("preserves WebDAV error identity and rejects out-of-root responses", async () => {
    const missing = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch: async () => new Response(null, { status: 404 })
    });
    await expect(missing.stat("/file")).rejects.toBeInstanceOf(FsError);
    const escaped = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch: async () =>
        new Response(properties.replace("/dav/file", "/outside/file"), { status: 207 })
    });
    await expect(escaped.stat("/file")).rejects.toMatchObject({ code: "EACCES" });
  });

  it("preserves S3 wire metadata names and advisory modes", async () => {
    const transport = new MockS3Client({ buckets: ["test"] });
    const filesystem = new S3FileSystem({ transport, bucket: "test" });
    await filesystem.writeFile("/file", new Uint8Array([1]), { mode: 0o600 });
    await filesystem.utimes("/file", 2000, 3000);
    const metadata = await transport.headObject({ Bucket: "test", Key: "file" });
    expect(metadata.Metadata).toMatchObject({
      "virtual-bash-mode": "384",
      "virtual-bash-atime": "2000",
      "virtual-bash-mtime": "3000"
    });
    expect(filesystem.capabilities.permissions).toBe(false);
    expect(await filesystem.stat("/file")).toMatchObject({ atimeMs: 2000, mtimeMs: 3000 });
  });

  it("does not turn copied S3 provider metadata into authority proof", async () => {
    const transport = new MockS3Client({ buckets: ["test"] });
    const filesystem = new S3FileSystem({ transport, bucket: "test" });
    await filesystem.writeFile("/file", new Uint8Array([1]));
    const headObject = transport.headObject.bind(transport);
    transport.headObject = async (input, options) => ({ ...(await headObject(input, options)) });
    const peer = new S3FileSystem({ transport, bucket: "test" });
    expect(await filesystem.compareEntry("/file", new ReadOnlyFileSystem(peer), "/file")).toBe(
      "unknown"
    );
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", new Uint8Array([1]));
    expect(await memory.compareEntry("/file", peer, "/file")).toBe("unknown");
  });

  it("constructs S3 HTTP without requests or ambient credential discovery", async () => {
    const request = vi.fn(() => {
      throw new Error("Unexpected network request");
    });
    const transport = createS3HttpTransport({
      endpoint: "https://s3.example.invalid",
      region: "test",
      credentials: { accessKeyId: "explicit", secretAccessKey: "explicit-secret" },
      request
    });
    expect(transport.capabilities?.conditionalPut).toBe(false);
    await expect(
      transport.putObject({
        Bucket: "bucket",
        Key: "file",
        Body: new Uint8Array([1]),
        IfNoneMatch: "*"
      })
    ).rejects.toMatchObject({ name: "NotImplemented" });
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses insecure HTTP unless explicitly enabled", () => {
    expect(() =>
      createS3HttpTransport({
        endpoint: "http://s3.example.invalid",
        region: "test",
        credentials: { accessKeyId: "explicit", secretAccessKey: "explicit-secret" }
      })
    ).toThrow();
  });

  it("sends signed S3 HTTP requests and decodes binary responses over loopback", async () => {
    const received: Array<{
      method: string | undefined;
      url: string | undefined;
      authorization: string | undefined;
      token: string | string[] | undefined;
    }> = [];
    const server = createServer((request, response) => {
      received.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        token: request.headers["x-amz-security-token"]
      });
      response.writeHead(200, {
        "content-length": "3",
        etag: '"version"',
        "x-amz-meta-virtual-bash-mode": "384"
      });
      response.end(new Uint8Array([0, 255, 1]));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing loopback listener");
      const transport = createS3HttpTransport({
        endpoint: `http://127.0.0.1:${address.port}`,
        region: "test",
        allowInsecureHttp: true,
        credentials: {
          accessKeyId: "explicit",
          secretAccessKey: "explicit-secret",
          sessionToken: "session"
        },
        clock: () => new Date("2026-01-01T00:00:00Z")
      });
      const response = await transport.getObject({ Bucket: "bucket", Key: "dir/a b" });
      expect(response.Body).toBeInstanceOf(Uint8Array);
      expect(Array.from(response.Body as Uint8Array)).toEqual([0, 255, 1]);
      expect(response.Metadata).toMatchObject({ "virtual-bash-mode": "384" });
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        method: "GET",
        url: "/bucket/dir/a%20b",
        token: "session"
      });
      expect(
        received[0]?.authorization?.startsWith(
          "AWS4-HMAC-SHA256 Credential=explicit/20260101/test/s3/aws4_request"
        )
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});

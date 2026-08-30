import { getEventListeners } from "node:events";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FsError,
  MemoryFileSystem,
  MockS3Client,
  S3FileSystem,
  WebDavFileSystem,
  collectBytes,
  createNodeFsBridge,
  createS3Transport,
  toByteSource
} from "../src/index.js";
import type { WebDavFetch } from "../src/index.js";

const originalAny = Object.getOwnPropertyDescriptor(AbortSignal, "any");
const originalTimeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
const bytes = new Uint8Array([0, 128, 255]);
const properties =
  '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/file</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>3</d:getcontentlength><d:getetag>"version"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';

function expectReleased(...signals: AbortSignal[]): void {
  for (const signal of signals) expect(getEventListeners(signal, "abort")).toEqual([]);
}

afterAll(() => {
  expect(Object.getOwnPropertyDescriptor(AbortSignal, "any")).toEqual(originalAny);
  expect(Object.getOwnPropertyDescriptor(AbortSignal, "timeout")).toEqual(originalTimeout);
});

describe.each(["native environment", "AbortSignal.any unavailable"])("%s", (profile) => {
  let deadlines: AbortController[];

  beforeEach(() => {
    deadlines = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const deadline = new AbortController();
      deadlines.push(deadline);
      return deadline.signal;
    });
    if (profile === "AbortSignal.any unavailable") {
      expect(Reflect.deleteProperty(AbortSignal, "any")).toBe(true);
      expect(Reflect.get(AbortSignal, "any")).toBeUndefined();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAny === undefined) Reflect.deleteProperty(AbortSignal, "any");
    else Object.defineProperty(AbortSignal, "any", originalAny);
    expect(Object.getOwnPropertyDescriptor(AbortSignal, "any")).toEqual(originalAny);
    expect(Object.getOwnPropertyDescriptor(AbortSignal, "timeout")).toEqual(originalTimeout);
  });

  it("keeps the single-signal bridge path working", async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/file", bytes);
    const caller = new AbortController();
    const bridge = createNodeFsBridge(filesystem, { signal: caller.signal });
    expect(await bridge.readFile("/file", "hex")).toBe("0080ff");
    expectReleased(caller.signal);
  });

  it("combines bridge and per-call signals through successful reads and writes", async () => {
    const configured = new AbortController();
    const caller = new AbortController();
    const bridge = createNodeFsBridge(new MemoryFileSystem(), { signal: configured.signal });
    for (let iteration = 0; iteration < 3; iteration += 1) {
      await bridge.writeFile("/file", bytes, { signal: caller.signal });
      expect(await bridge.readFile("/file", { encoding: "hex", signal: caller.signal })).toBe(
        "0080ff"
      );
      expectReleased(configured.signal, caller.signal);
    }
  });

  it.each(["configured", "per-call"])(
    "preserves the first %s abort reason at the bridge's backing call",
    async (first) => {
      const configured = new AbortController();
      const caller = new AbortController();
      const reason = Object.freeze({ source: first });
      const laterReason = Object.freeze({ source: "later" });
      const filesystem = new MemoryFileSystem();
      let forwarded: AbortSignal | undefined;
      const read = vi.spyOn(filesystem, "readFile").mockImplementation(async (_path, options) => {
        forwarded = options?.signal;
        const [winner, later] =
          first === "configured" ? [configured, caller] : [caller, configured];
        winner.abort(reason);
        later.abort(laterReason);
        forwarded?.throwIfAborted();
        return bytes;
      });
      const bridge = createNodeFsBridge(filesystem, { signal: configured.signal });
      await expect(bridge.readFile("/file", { signal: caller.signal })).rejects.toMatchObject({
        code: "ABORT_ERR"
      });
      expect(read).toHaveBeenCalledOnce();
      expect(forwarded?.reason).toBe(reason);
      expectReleased(configured.signal, caller.signal);
    }
  );

  it("rejects pre-aborted bridge inputs without invoking the backing filesystem", async () => {
    const configured = new AbortController();
    const caller = new AbortController();
    configured.abort(Object.freeze({ source: "configured" }));
    caller.abort(Object.freeze({ source: "caller" }));
    const filesystem = new MemoryFileSystem();
    const read = vi.spyOn(filesystem, "readFile");
    const bridge = createNodeFsBridge(filesystem, { signal: configured.signal });
    await expect(bridge.readFile("/file", { signal: caller.signal })).rejects.toMatchObject({
      code: "ABORT_ERR"
    });
    expect(read).not.toHaveBeenCalled();
    expectReleased(configured.signal, caller.signal);
  });

  it("preserves backend rejection and releases both bridge inputs", async () => {
    const configured = new AbortController();
    const caller = new AbortController();
    const failure = new Error("backing read failed");
    const filesystem = new MemoryFileSystem();
    vi.spyOn(filesystem, "readFile").mockRejectedValue(failure);
    const bridge = createNodeFsBridge(filesystem, { signal: configured.signal });
    await expect(bridge.readFile("/file", { signal: caller.signal })).rejects.toBe(failure);
    expectReleased(configured.signal, caller.signal);
  });

  it("streams S3 reads with an explicit caller signal", async () => {
    const transport = new MockS3Client({ buckets: ["test"] });
    const filesystem = new S3FileSystem({ transport, bucket: "test" });
    await filesystem.writeFile("/file", bytes);
    const caller = new AbortController();
    const result = await collectBytes(filesystem.readStream!("/file", { signal: caller.signal }), {
      maxBytes: bytes.length
    });
    expect(result).toEqual(bytes);
    expectReleased(caller.signal);
  });

  it("streams S3 writes with an explicit caller signal", async () => {
    const transport = new MockS3Client({ buckets: ["test"] });
    const filesystem = new S3FileSystem({ transport, bucket: "test" });
    const caller = new AbortController();
    await filesystem.writeStream!("/file", toByteSource(bytes), { signal: caller.signal });
    expect(await filesystem.readFile("/file")).toEqual(bytes);
    expectReleased(caller.signal);
  });

  it("uses the S3 conditional-PUT rename fallback with a caller signal", async () => {
    const client = new MockS3Client({ buckets: ["test"] });
    const transport = createS3Transport(client, { ...client.capabilities, conditionalCopy: false });
    const filesystem = new S3FileSystem({ transport, bucket: "test" });
    await filesystem.writeFile("/source", bytes);
    const caller = new AbortController();
    await filesystem.rename("/source", "/destination", { signal: caller.signal });
    expect(await filesystem.readFile("/destination")).toEqual(bytes);
    await expect(filesystem.stat("/source")).rejects.toMatchObject({ code: "ENOENT" });
    expectReleased(caller.signal);
  });

  it("aborts the S3 read transport on iterator return without aborting the caller", async () => {
    const transport = new MockS3Client({ buckets: ["test"] });
    const get = transport.getObjectStream.bind(transport);
    let forwarded: AbortSignal | undefined;
    vi.spyOn(transport, "getObjectStream").mockImplementation(async (input, options) => {
      forwarded = options?.abortSignal;
      return get(input, options);
    });
    const filesystem = new S3FileSystem({ transport, bucket: "test" });
    await filesystem.writeFile("/file", bytes);
    const caller = new AbortController();
    const iterator = filesystem.readStream!("/file", { signal: caller.signal })[
      Symbol.asyncIterator
    ]();
    expect((await iterator.next()).value).toEqual(bytes);
    await iterator.return?.();
    expect(forwarded?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expectReleased(caller.signal);
  });

  it("preserves caller reason at the S3 transport during cancellation", async () => {
    const transport = new MockS3Client({ buckets: ["test"] });
    const get = transport.getObjectStream.bind(transport);
    const caller = new AbortController();
    const reason = Object.freeze({ source: "caller" });
    let forwarded: AbortSignal | undefined;
    vi.spyOn(transport, "getObjectStream").mockImplementation(async (input, options) => {
      const output = await get(input, options);
      forwarded = options?.abortSignal;
      caller.abort(reason);
      return output;
    });
    const filesystem = new S3FileSystem({ transport, bucket: "test" });
    await filesystem.writeFile("/file", bytes);
    await expect(
      collectBytes(filesystem.readStream!("/file", { signal: caller.signal }), {
        maxBytes: bytes.length
      })
    ).rejects.toMatchObject({ code: "ECANCELED" });
    expect(forwarded?.reason).toBe(reason);
    expectReleased(caller.signal);
  });

  it("releases the S3 caller after an upload producer rejects", async () => {
    const transport = new MockS3Client({ buckets: ["test"] });
    const filesystem = new S3FileSystem({ transport, bucket: "test" });
    const caller = new AbortController();
    const failure = new Error("upload producer failed");
    const source = (async function* () {
      yield bytes;
      throw failure;
    })();
    await expect(
      filesystem.writeStream!("/file", source, { signal: caller.signal })
    ).rejects.toMatchObject({ code: "EIO", cause: failure });
    expectReleased(caller.signal);
  });

  it("performs WebDAV requests with a caller signal and releases deadline inputs", async () => {
    const fetch = vi.fn<WebDavFetch>(async () => new Response(properties, { status: 207 }));
    const filesystem = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch });
    const caller = new AbortController();
    expect(await filesystem.stat("/file", { signal: caller.signal })).toMatchObject({
      type: "file",
      size: bytes.length
    });
    expect(fetch).toHaveBeenCalledOnce();
    expectReleased(caller.signal, ...deadlines.map((deadline) => deadline.signal));
  });

  it("releases WebDAV request signals after an injected transport rejects", async () => {
    const failure = new Error("transport failed");
    const fetch = vi.fn<WebDavFetch>().mockRejectedValue(failure);
    const filesystem = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch });
    const caller = new AbortController();
    await expect(filesystem.stat("/file", { signal: caller.signal })).rejects.toMatchObject({
      code: "EIO",
      cause: failure
    });
    expectReleased(caller.signal, ...deadlines.map((deadline) => deadline.signal));
  });

  it("releases WebDAV request signals when a read iterator returns early", async () => {
    const fetch: WebDavFetch = async (_url, init) =>
      init.method === "PROPFIND" ? new Response(properties, { status: 207 }) : new Response(bytes);
    const filesystem = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch });
    const caller = new AbortController();
    const iterator = filesystem
      .readStream("/file", { signal: caller.signal })
      [Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual(bytes);
    await iterator.return?.(undefined);
    expect(caller.signal.aborted).toBe(false);
    expectReleased(caller.signal, ...deadlines.map((deadline) => deadline.signal));
  });

  it("preserves stream-construction failure and releases WebDAV input signals", async () => {
    const failure = new Error("stream construction failed");
    const fetch = vi.fn<WebDavFetch>(async () => {
      throw new Error("Unexpected transport call");
    });
    const filesystem = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch });
    const caller = new AbortController();
    vi.spyOn(globalThis, "ReadableStream").mockImplementation(() => {
      throw failure;
    });
    await expect(
      filesystem.writeStream("/file", toByteSource(bytes), { flag: "wx", signal: caller.signal })
    ).rejects.toBe(failure);
    expect(fetch).not.toHaveBeenCalled();
    expectReleased(caller.signal, ...deadlines.map((deadline) => deadline.signal));
  });

  it("preserves an atomic-rmdir binding error and releases its input signals", async () => {
    const failure = new FsError("EIO", { syscall: "rmdir", path: "/empty" });
    const filesystem = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch: async () => {
        throw new Error("Unexpected transport call");
      },
      atomicEmptyDirectory: {
        namespaceUrl: "https://example.invalid/dav/",
        removeEmptyDirectory: async () => {
          throw failure;
        }
      }
    });
    vi.spyOn(filesystem, "stat").mockResolvedValue(await new MemoryFileSystem().stat("/"));
    const caller = new AbortController();
    await expect(filesystem.rmdir("/empty", { signal: caller.signal })).rejects.toBe(failure);
    expectReleased(caller.signal, ...deadlines.map((deadline) => deadline.signal));
  });

  it.each([false, true])("uploads WebDAV streams with caller signal=%s", async (withCaller) => {
    const uploaded: number[] = [];
    const fetch = vi.fn<WebDavFetch>(async (_url, init) => {
      expect(init.method).toBe("PUT");
      expect(Reflect.get(init, "duplex")).toBe("half");
      if (!(init.body instanceof ReadableStream)) throw new Error("Expected a streaming upload");
      const reader = init.body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          uploaded.push(...chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      return new Response(null, { status: 201 });
    });
    const filesystem = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch });
    const caller = new AbortController();
    await filesystem.writeStream("/file", toByteSource(bytes), {
      flag: "wx",
      ...(withCaller ? { signal: caller.signal } : {})
    });
    expect(uploaded).toEqual(Array.from(bytes));
    expect(fetch).toHaveBeenCalledOnce();
    expectReleased(caller.signal, ...deadlines.map((deadline) => deadline.signal));
  });

  it.each(["caller", "timeout"])(
    "preserves WebDAV %s cancellation reason and error mapping",
    async (winner) => {
      const caller = new AbortController();
      const reason = Object.freeze({ source: winner });
      let forwarded: AbortSignal | null | undefined;
      const fetch: WebDavFetch = async (_url, init) => {
        forwarded = init.signal;
        const deadline = deadlines[0];
        if (deadline === undefined) throw new Error("Missing deadline signal");
        if (winner === "caller") {
          caller.abort(reason);
          deadline.abort(Object.freeze({ source: "later deadline" }));
        } else deadline.abort(reason);
        return new Response(properties, { status: 207 });
      };
      const filesystem = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch });
      await expect(filesystem.stat("/file", { signal: caller.signal })).rejects.toMatchObject({
        code: winner === "caller" ? "ECANCELED" : "ETIMEDOUT",
        cause: reason
      });
      expect(forwarded?.reason).toBe(reason);
      expectReleased(caller.signal, ...deadlines.map((deadline) => deadline.signal));
    }
  );

  it("passes a composed signal to the WebDAV atomic empty-directory binding", async () => {
    const fetch = vi.fn<WebDavFetch>(async () => {
      throw new Error("Unexpected transport call");
    });
    const removeEmptyDirectory = vi.fn(
      async (request: {
        operation: "atomic-empty-rmdir/v1";
        namespaceUrl: string;
        path: string;
        signal?: AbortSignal;
      }) => ({
        operation: request.operation,
        namespaceUrl: request.namespaceUrl,
        path: request.path,
        outcome: "removed" as const
      })
    );
    const filesystem = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch,
      atomicEmptyDirectory: { namespaceUrl: "https://example.invalid/dav/", removeEmptyDirectory }
    });
    vi.spyOn(filesystem, "stat").mockResolvedValue(await new MemoryFileSystem().stat("/"));
    const caller = new AbortController();
    await filesystem.rmdir("/empty", { signal: caller.signal });
    expect(removeEmptyDirectory).toHaveBeenCalledOnce();
    expect(removeEmptyDirectory.mock.calls[0]?.[0]).toMatchObject({
      operation: "atomic-empty-rmdir/v1",
      namespaceUrl: "https://example.invalid/dav/",
      path: "/empty",
      signal: expect.any(AbortSignal)
    });
    expect(fetch).not.toHaveBeenCalled();
    expectReleased(caller.signal, ...deadlines.map((deadline) => deadline.signal));
  });
});

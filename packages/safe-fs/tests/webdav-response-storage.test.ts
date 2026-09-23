import { afterEach, describe, expect, it, vi } from "vitest";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { MockDav } from "./migration/fs/webdav/mock.js";

afterEach(() => vi.unstubAllGlobals());

function remote(response: Response, options = {}) {
  const mock = new MockDav();
  mock.files.set("/file", new Uint8Array([1]));
  return new WebDavFileSystem({
    baseUrl: "https://example.invalid/dav/", ...options,
    fetch: async (url, init) => init?.method === "GET" ? response : mock.fetch(url, init),
  });
}

function streamed(chunks: Uint8Array[], headers = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { headers });
}

describe("WebDAV response storage", () => {
  it("allocates one result buffer without copying each declared-length chunk", async () => {
    const chunks = [new Uint8Array(4096).fill(1), new Uint8Array(4096).fill(2)];
    const fs = remote(streamed(chunks, { "Content-Length": "8192" }));
    vi.spyOn(fs, "stat").mockResolvedValue(await fs.stat("/file"));
    const allocations: unknown[] = [];
    vi.stubGlobal("Uint8Array", new Proxy(Uint8Array, {
      construct(target, args) { allocations.push(args[0]); return Reflect.construct(target, args); },
    }));
    const data = await fs.readFile("/file");
    expect(data).toEqual(new Uint8Array([...chunks[0]!, ...chunks[1]!]));
    expect(allocations.filter(value => value === chunks[0] || value === chunks[1])).toHaveLength(0);
    expect(allocations.filter(value => value === 8192)).toHaveLength(1);
  });

  it.each([{}, { "Content-Length": "1", "Content-Encoding": "gzip" }])("bounds growing storage and preserves bytes: %j", async headers => {
    const chunks = [new Uint8Array(3).fill(1), new Uint8Array(5).fill(2), new Uint8Array(9).fill(3)];
    const data = await remote(streamed(chunks, headers), { maxResponseBytes: 20 }).readFile("/file");
    expect([...data]).toEqual(chunks.flatMap(chunk => [...chunk]));
    expect(data.buffer.byteLength).toBeLessThanOrEqual(20);
  });

  it("rejects oversized responses with the default ceiling before reading", async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.close(); } }), { headers: { "Content-Length": String(16 * 1024 * 1024 + 1) } });
    await expect(remote(response).readFile("/file")).rejects.toMatchObject({ code: "EFBIG" });
  });

  it("limits metadata before decoding with the default ceiling", async () => {
    const fs = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch: async () => new Response("", { status: 207, headers: { "Content-Length": String(1024 * 1024 + 1) } }),
    });
    await expect(fs.stat("/file")).rejects.toMatchObject({ code: "EFBIG" });
  });

  it("grows unknown-length storage without retaining chunk copies or a final result copy", async () => {
    const chunks = [new Uint8Array(3), new Uint8Array(5), new Uint8Array(9)];
    const fs = remote(streamed(chunks), { maxResponseBytes: 20 });
    vi.spyOn(fs, "stat").mockResolvedValue(await fs.stat("/file"));
    const allocations: unknown[] = [];
    vi.stubGlobal("Uint8Array", new Proxy(Uint8Array, {
      construct(target, args) { allocations.push(args[0]); return Reflect.construct(target, args); },
    }));
    const data = await fs.readFile("/file");
    expect(data.byteLength).toBe(17);
    expect(allocations).toEqual([0, 3, 8, 17]);
  });

  it.each(["2", "4", "invalid"])("preserves Content-Length validation: %s", async length => {
    await expect(remote(streamed([new Uint8Array(3)], { "Content-Length": length })).readFile("/file")).rejects.toMatchObject({ code: "EIO" });
  });

  it("cancels unknown-length responses exceeding the configured limit", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel,
    }));
    await expect(remote(response, { maxResponseBytes: 4 }).readFile("/file")).rejects.toMatchObject({ code: "EFBIG" });
    expect(cancel).toHaveBeenCalled();
  });
});

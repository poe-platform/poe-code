import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem, FsError } from "./engine/index.js";
import { decodeError, encodeError, hostFileSystem, remoteFileSystem } from "./execution-filesystem.js";

vi.mock("./engine/index.js", async () => {
  const { buildBrowserEngine } = await import("./engine/build-plugin.mjs");
  const built = await buildBrowserEngine();
  return import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`
  );
});

function fixture() {
  const filesystem = createMemoryFileSystem();
  const controller = new AbortController();
  const host = hostFileSystem(filesystem, controller.signal);
  const remote = remoteFileSystem(structuredClone(host.description), async (method, args) => {
    try {
      return structuredClone(await host.dispatch(method, structuredClone(args)));
    } catch (error) {
      throw decodeError(structuredClone(encodeError(error)));
    }
  });
  return { filesystem, controller, host, remote };
}

describe("execution filesystem bridge", () => {
  it("preserves filesystem error context as well as the errno code", () => {
    const error = new FsError("ENOENT", { syscall: "rename", path: "/source", dest: "/destination" });
    expect(decodeError(structuredClone(encodeError(error)))).toMatchObject({
      code: "ENOENT", syscall: "rename", path: "/source", dest: "/destination", message: error.message
    });
  });

  it("preserves binary bytes, errors, hardlinks, and clone-safe stat identity", async () => {
    const { filesystem, host, remote } = fixture();
    const bytes = new Uint8Array([0, 128, 255]);
    await remote.writeFile("/source", bytes);
    bytes.fill(42);
    expect(await remote.readFile("/source")).toEqual(new Uint8Array([0, 128, 255]));
    await remote.link!("/source", "/linked");
    const source = await remote.stat("/source");
    const linked = await remote.stat("/linked");
    expect(source.identityScope).toBeDefined();
    expect(source.identityScope).toBe(linked.identityScope);
    expect(source.ino).toBe(linked.ino);
    expect(await remote.compareEntry!("/source", remote, "/linked")).toBe("same");
    expect(await remote.compareEntry!("/source", filesystem, "/source")).toBe("unknown");
    await expect(remote.readFile("/missing")).rejects.toBeInstanceOf(FsError);
    await expect(remote.readFile("/missing")).rejects.toMatchObject({ code: "ENOENT" });
    await host.close();
  });

  it("preserves options and aborts before dispatch without cloning signals", async () => {
    const { host, remote } = fixture();
    await remote.writeFile("/file", new Uint8Array([1]), { flag: "wx" });
    await expect(remote.writeFile("/file", new Uint8Array(), { flag: "wx" })).rejects.toMatchObject({ code: "EEXIST" });
    const controller = new AbortController();
    controller.abort(new Error("caller cancellation"));
    await expect(remote.readFile("/file", { signal: controller.signal })).rejects.toThrow("caller cancellation");
    expect(await remote.readFile("/file")).toEqual(new Uint8Array([1]));
    await host.close();
  });

  it("rejects unknown methods and keeps optional capabilities absent", async () => {
    const { host } = fixture();
    await expect(host.dispatch("constructor", [])).rejects.toThrow("Unsupported filesystem operation");
    const remote = remoteFileSystem({ capabilities: {}, methods: ["readFile"] }, vi.fn());
    expect(remote.readStream).toBeUndefined();
    expect(remote.writeStream).toBeUndefined();
    expect(remote.compareEntry).toBeUndefined();
    await host.close();
  });

  it("pulls streams lazily and closes an early consumer exactly once", async () => {
    const { filesystem, controller, host } = fixture();
    await filesystem.writeFile("/file", new Uint8Array([1, 2, 3, 4]));
    await host.close();
    const readStream = vi.spyOn(filesystem, "readStream");
    const streamingHost = hostFileSystem(filesystem, controller.signal);
    const request = vi.fn((method, args) => streamingHost.dispatch(method, args));
    const remote = remoteFileSystem(streamingHost.description, request);
    const iterator = remote.readStream!("/file", { chunkSize: 2, start: 1, endExclusive: 3 })[Symbol.asyncIterator]();
    expect(readStream).not.toHaveBeenCalled();
    expect(await iterator.next()).toEqual({ done: false, value: new Uint8Array([2, 3]) });
    await iterator.return!();
    await iterator.return!();
    expect(request.mock.calls.filter(([method]) => method === "stream-close")).toHaveLength(1);
    expect(await iterator.next()).toMatchObject({ done: true });
    await streamingHost.close();
  });

  it("closes admitted stream resources when execution is terminated", async () => {
    const { filesystem, controller, host } = fixture();
    await host.close();
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    vi.spyOn(filesystem, "readStream").mockReturnValue({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: new Uint8Array([1]) }), return: close })
    });
    const streamingHost = hostFileSystem(filesystem, controller.signal);
    const identity = await streamingHost.dispatch("stream-open", ["/file"]);
    await streamingHost.dispatch("stream-next", [identity]);
    controller.abort();
    await streamingHost.close();
    await streamingHost.close();
    expect(close).toHaveBeenCalledTimes(1);
    await expect(streamingHost.dispatch("writeFile", ["/late", new Uint8Array()])).rejects.toMatchObject({ code: "ECANCELED" });
  });

  it("bounds pending requests and waits for admitted work before closing", async () => {
    const { filesystem, host } = fixture();
    await host.close();
    let release!: (data: Uint8Array) => void;
    const blocked = new Promise<Uint8Array>((resolve) => { release = resolve; });
    vi.spyOn(filesystem, "readFile").mockReturnValue(blocked);
    const bounded = hostFileSystem(filesystem, new AbortController().signal);
    const requests = Array.from({ length: 64 }, () => bounded.dispatch("readFile", ["/file"]));
    await expect(bounded.dispatch("readFile", ["/file"])).rejects.toThrow("request limit");
    let closed = false;
    const closing = bounded.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release(new Uint8Array([1]));
    await Promise.all(requests);
    await closing;
    expect(closed).toBe(true);
  });

  it("preserves guarded streaming writes and closes the producer on failure", async () => {
    const { filesystem, host, remote } = fixture();
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const append = vi.spyOn(filesystem, "appendFile").mockRejectedValue(new Error("workspace exhausted"));
    await expect(remote.writeStream!("/file", {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: new Uint8Array([1]) }), return: close })
    })).rejects.toThrow("workspace exhausted");
    expect(append).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(await filesystem.readFile("/file")).toEqual(new Uint8Array());
    await host.close();
  });
});

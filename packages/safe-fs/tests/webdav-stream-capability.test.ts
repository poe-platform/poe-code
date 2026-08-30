import { afterEach, describe, expect, it, vi } from "vitest";
import { FsError } from "../src/contracts/errors.js";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import type { WebDavFetch, WebDavFileSystemOptions } from "../src/fs/webdav/webdav.js";

const bytes = new TextEncoder().encode("stream bytes");

function source() {
  const next = vi
    .fn()
    .mockResolvedValueOnce({ done: false, value: bytes })
    .mockResolvedValue({ done: true, value: undefined });
  const close = vi.fn().mockResolvedValue({ done: true, value: undefined });
  const acquire = vi.fn(() => ({ next, return: close }));
  return { input: { [Symbol.asyncIterator]: acquire }, acquire, next, close };
}

function transport() {
  const written: Uint8Array[] = [];
  const fetch = vi.fn<WebDavFetch>(async (_url, init) => {
    if (init.method !== "PUT") return new Response(null, { status: 404 });
    written.push(new Uint8Array(await new Response(init.body).arrayBuffer()));
    return new Response(null, { status: 201 });
  });
  return { fetch, written };
}

afterEach(() => vi.unstubAllGlobals());

describe("WebDAV request stream capability", () => {
  for (const declaration of [undefined, false] as const) {
    for (const flag of ["w", "wx", "a", "ax"] as const) {
      it(`denies custom ${String(declaration)} ${flag} before source acquisition or any transport call`, async () => {
        const wire = transport();
        const input = source();
        const filesystem = new WebDavFileSystem({
          baseUrl: "https://example.invalid/dav/",
          fetch: wire.fetch,
          ...(declaration === undefined ? {} : { requestStreamSupport: declaration })
        });
        await expect(
          filesystem.writeStream("/parent/existing", input.input, { flag })
        ).rejects.toMatchObject({ code: "ENOTSUP", syscall: "writeStream" });
        expect(wire.fetch).not.toHaveBeenCalled();
        expect(input.acquire).not.toHaveBeenCalled();
        expect(input.next).not.toHaveBeenCalled();
        expect(input.close).not.toHaveBeenCalled();
      });
    }
  }

  for (const mode of ["coercion", "ignores-duplex", "throws"] as const) {
    for (const direct of [false, true]) {
      it(`denies ${direct ? "direct" : "delegated"} native ${mode} without I/O`, async () => {
        const wire = transport();
        const input = source();
        const probe = vi.fn(function (_url: string, init: RequestInit & { duplex?: string }) {
          if (mode === "throws") throw new TypeError("unsupported body");
          if (mode === "coercion") void init.duplex;
          return {
            headers: new Headers(
              mode === "coercion" ? { "Content-Type": "text/plain;charset=UTF-8" } : {}
            )
          };
        });
        vi.stubGlobal("Request", probe);
        if (direct) vi.stubGlobal("fetch", wire.fetch);
        const filesystem = new WebDavFileSystem({
          baseUrl: "https://example.invalid/dav/",
          fetch: wire.fetch,
          ...(direct ? {} : { requestStreamSupport: "native" as const })
        });
        await expect(
          filesystem.writeStream("/new", input.input, { flag: "wx" })
        ).rejects.toMatchObject({ code: "ENOTSUP" });
        expect(probe).toHaveBeenCalledOnce();
        expect(wire.fetch).not.toHaveBeenCalled();
        expect(input.acquire).not.toHaveBeenCalled();
        expect(input.close).not.toHaveBeenCalled();
      });
    }
  }

  for (const declaration of [undefined, false, true, "native"] as const) {
    it(`preserves pre-abort before probe or source for ${String(declaration)}`, async () => {
      const wire = transport();
      const input = source();
      const controller = new AbortController();
      controller.abort("caller owns cancellation");
      const probe = vi.fn(() => {
        throw new Error("must not probe");
      });
      vi.stubGlobal("Request", probe);
      const filesystem = new WebDavFileSystem({
        baseUrl: "https://example.invalid/dav/",
        fetch: wire.fetch,
        ...(declaration === undefined ? {} : { requestStreamSupport: declaration })
      });
      await expect(
        filesystem.writeStream("/new", input.input, { flag: "wx", signal: controller.signal })
      ).rejects.toMatchObject({ code: "ECANCELED" });
      expect(probe).not.toHaveBeenCalled();
      expect(wire.fetch).not.toHaveBeenCalled();
      expect(input.acquire).not.toHaveBeenCalled();
      expect(controller.signal.reason).toBe("caller owns cancellation");
    });
  }

  for (const direct of [false, true]) {
    it(`preserves genuine native Request stream support for ${direct ? "direct" : "delegated"} transport`, async () => {
      const wire = transport();
      const input = source();
      if (direct) vi.stubGlobal("fetch", wire.fetch);
      const filesystem = new WebDavFileSystem({
        baseUrl: "https://example.invalid/dav/",
        fetch: wire.fetch,
        ...(direct ? {} : { requestStreamSupport: "native" as const })
      });
      await filesystem.writeStream("/new", input.input, { flag: "wx" });
      expect(wire.written).toEqual([bytes]);
      expect(input.acquire).toHaveBeenCalledOnce();
      expect(input.next).toHaveBeenCalledTimes(2);
      expect(input.close).not.toHaveBeenCalled();
      expect(wire.fetch.mock.calls[0]?.[1]).toMatchObject({
        duplex: "half",
        credentials: "omit",
        redirect: "manual"
      });
    });
  }

  it("accepts a trusted custom declaration independently of native Request support", async () => {
    const wire = transport();
    const input = source();
    const probe = vi.fn(() => {
      throw new Error("native request unavailable");
    });
    vi.stubGlobal("Request", probe);
    const options: WebDavFileSystemOptions = {
      baseUrl: "https://example.invalid/dav/",
      fetch: wire.fetch,
      requestStreamSupport: true
    };
    const filesystem = new WebDavFileSystem(options);
    Object.assign(options, { requestStreamSupport: false });
    await filesystem.writeStream("/new", input.input, { flag: "wx" });
    expect(wire.written).toEqual([bytes]);
    expect(probe).not.toHaveBeenCalled();
    expect(input.acquire).toHaveBeenCalledOnce();
  });

  it("does not infer support for a bound native-looking function", async () => {
    const wire = transport();
    vi.stubGlobal("fetch", wire.fetch);
    const filesystem = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch: wire.fetch.bind(globalThis)
    });
    const input = source();
    await expect(filesystem.writeStream("/new", input.input, { flag: "wx" })).rejects.toMatchObject(
      { code: "ENOTSUP" }
    );
    expect(wire.fetch).not.toHaveBeenCalled();
    expect(input.acquire).not.toHaveBeenCalled();
  });

  it("lets explicit false disable an otherwise direct native transport", async () => {
    const wire = transport();
    vi.stubGlobal("fetch", wire.fetch);
    const filesystem = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch: wire.fetch,
      requestStreamSupport: false
    });
    const input = source();
    await expect(filesystem.writeStream("/new", input.input, { flag: "wx" })).rejects.toMatchObject(
      { code: "ENOTSUP" }
    );
    expect(wire.fetch).not.toHaveBeenCalled();
    expect(input.acquire).not.toHaveBeenCalled();
  });

  it("calls directly recognized native Fetch with its realm receiver", async () => {
    const wire = transport();
    const direct = vi.fn<WebDavFetch>(function (this: unknown, url, init) {
      expect(this).toBe(globalThis);
      return wire.fetch(url, init);
    });
    vi.stubGlobal("fetch", direct);
    const filesystem = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch: direct
    });
    await filesystem.writeStream("/new", source().input, { flag: "wx" });
    await filesystem.writeFile("/bytes", bytes, { flag: "wx" });
    expect(wire.written).toEqual([bytes, bytes]);
  });

  for (const declaration of [undefined, false, "native"] as const) {
    it(`does not gate ordinary byte writes with ${String(declaration)}`, async () => {
      const wire = transport();
      const probe = vi.fn(() => {
        throw new Error("must not probe byte writes");
      });
      vi.stubGlobal("Request", probe);
      const filesystem = new WebDavFileSystem({
        baseUrl: "https://example.invalid/dav/",
        fetch: wire.fetch,
        ...(declaration === undefined ? {} : { requestStreamSupport: declaration })
      });
      await filesystem.writeFile("/new", bytes, { flag: "wx" });
      expect(wire.written).toEqual([bytes]);
      expect(probe).not.toHaveBeenCalled();
    });
  }

  for (const invalid of [null, 0, "true", "auto", {}, () => true]) {
    it(`rejects invalid declaration ${String(invalid)}`, () => {
      const options = {
        baseUrl: "https://example.invalid/dav/",
        fetch: transport().fetch,
        requestStreamSupport: invalid
      };
      expect(
        () => new WebDavFileSystem(options as unknown as WebDavFileSystemOptions)
      ).toThrowError(expect.objectContaining({ code: "EINVAL" }));
    });
  }

  it("preserves source error over iterator cleanup failure", async () => {
    const wire = transport();
    const input = source();
    const primary = new FsError("ENOSPC", { message: "source primary" });
    input.next.mockReset().mockRejectedValue(primary);
    input.close.mockRejectedValue(new Error("cleanup secondary"));
    const filesystem = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch: wire.fetch,
      requestStreamSupport: true
    });
    await expect(filesystem.writeStream("/new", input.input, { flag: "wx" })).rejects.toBe(primary);
    expect(input.close).toHaveBeenCalledOnce();
  });

  it("retains post-send detection without claiming to protect against a dishonest trusted transport", async () => {
    const wire = vi.fn<WebDavFetch>(async () => new Response(null, { status: 201 }));
    const input = source();
    const filesystem = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch: wire,
      requestStreamSupport: true
    });
    await expect(filesystem.writeStream("/new", input.input, { flag: "wx" })).rejects.toMatchObject(
      { code: "EIO" }
    );
    expect(wire).toHaveBeenCalledOnce();
    expect(input.acquire).not.toHaveBeenCalled();
  });

  it("preserves in-flight caller cancellation over producer and cleanup errors", async () => {
    const wire = transport();
    const input = source();
    const caller = new AbortController();
    const reason = { caller: true };
    input.next.mockReset().mockImplementation(async () => {
      caller.abort(reason);
      throw new Error("producer secondary");
    });
    input.close.mockRejectedValue(new Error("cleanup secondary"));
    const filesystem = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/",
      fetch: wire.fetch,
      requestStreamSupport: true
    });
    await expect(
      filesystem.writeStream("/new", input.input, { flag: "wx", signal: caller.signal })
    ).rejects.toMatchObject({ code: "ECANCELED" });
    expect(caller.signal.reason).toBe(reason);
    expect(input.acquire).toHaveBeenCalledOnce();
    expect(input.close).toHaveBeenCalledOnce();
  });
});

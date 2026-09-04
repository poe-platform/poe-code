import { afterEach, describe, expect, it, vi } from "vitest";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { MockDav } from "./migration/fs/webdav/mock.js";

afterEach(() => { vi.useRealTimers(); });

describe("WebDAV ancestor-walk deadlines", () => {
  it.each(["stat", "writeFile", "writeStream"] as const)(
    "bounds the complete %s walk before further requests or upload acquisition",
    async operation => {
      vi.useFakeTimers();
      const mock = new MockDav();
      let parent = "";
      for (let index = 0; index < 5; index++) {
        parent += "/directory";
        mock.files.set(parent, null);
      }
      const methods: string[] = [];
      const acquire = vi.fn(async function* () { yield new Uint8Array([1]); });
      const remote = new WebDavFileSystem({
        baseUrl: "https://example.invalid/dav/",
        timeoutMs: 10,
        requestStreamSupport: true,
        fetch: async (url, init) => {
          methods.push(init.method!);
          await new Promise(resolve => setTimeout(resolve, 6));
          return mock.fetch(url, init);
        }
      });
      const path = parent + "/missing";
      const pending = (operation === "stat"
        ? remote.stat(path)
        : operation === "writeFile"
          ? remote.writeFile(path, new Uint8Array([1]), { flag: "wx" })
          : remote.writeStream(path, { [Symbol.asyncIterator]: acquire }, { flag: "wx" })
      ).catch(error => error);
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ code: "ETIMEDOUT" });
      expect(methods).toEqual(["PROPFIND", "PROPFIND"]);
      expect(acquire).not.toHaveBeenCalled();
      expect(mock.files.has(path)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(["stat", "writeFile", "writeStream"] as const)("bounds %s path depth and UTF-8 bytes before fetching", async operation => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    const acquire = vi.fn(async function* () { yield new Uint8Array([1]); });
    const remote = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch, requestStreamSupport: true });
    for (const path of ["/directory".repeat(257), "/" + "é".repeat(32_768)]) {
      const pending = operation === "stat" ? remote.stat(path)
        : operation === "writeFile" ? remote.writeFile(path, new Uint8Array([1]))
          : remote.writeStream(path, { [Symbol.asyncIterator]: acquire });
      await expect(pending).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("admits paths exactly at the existing component and byte boundaries", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    const remote = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch });
    for (const path of ["/d".repeat(256), "/" + "x".repeat(65_535)]) {
      await expect(remote.stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("isolates concurrent walks even when the caller reuses an options object", async () => {
    vi.useFakeTimers();
    const mock = new MockDav();
    mock.files.set("/directory", null);
    mock.files.set("/file", new Uint8Array([1]));
    const remote = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/", timeoutMs: 10,
      fetch: async (url, init) => {
        await new Promise(resolve => setTimeout(resolve, url.endsWith("/file") ? 8 : 6));
        return mock.fetch(url, init);
      }
    });
    const options = {};
    const first = remote.stat("/directory/missing", options).catch(error => error);
    await vi.advanceTimersByTimeAsync(5);
    let secondSettled = false;
    const second = remote.stat("/file", options).finally(() => { secondSettled = true; });
    await vi.advanceTimersByTimeAsync(5);
    expect(await first).toMatchObject({ code: "ETIMEDOUT" });
    expect(secondSettled).toBe(false);
    await vi.runAllTimersAsync();
    expect(await second).toMatchObject({ type: "file", size: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives the upload its own request deadline after successful preflight", async () => {
    vi.useFakeTimers();
    const mock = new MockDav();
    mock.files.set("/directory", null);
    const remote = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/", timeoutMs: 10,
      fetch: async (url, init) => {
        await new Promise(resolve => setTimeout(resolve, 6));
        return mock.fetch(url, init);
      }
    });
    const pending = remote.writeFile("/directory/file", new Uint8Array([1]), { flag: "wx" });
    await vi.runAllTimersAsync();
    await pending;
    expect(mock.files.get("/directory/file")).toEqual(new Uint8Array([1]));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("disposes a walk failing during an ancestor request, caller cancellation %s", async cancelled => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const reason = new Error("caller cancellation");
    let requests = 0;
    const remote = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/", timeoutMs: 10,
      fetch: async () => {
        const status = requests++ === 0 ? 404 : 500;
        await new Promise(resolve => setTimeout(resolve, 4));
        return new Response(null, { status });
      }
    });
    const pending = remote.stat("/directory/missing", { signal: caller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(5);
    if (cancelled) caller.abort(reason);
    await vi.advanceTimersByTimeAsync(3);
    const error = await pending;
    expect(error).toMatchObject({ code: cancelled ? "ECANCELED" : "EIO" });
    if (cancelled) expect(error.cause).toBe(reason);
    expect(requests).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

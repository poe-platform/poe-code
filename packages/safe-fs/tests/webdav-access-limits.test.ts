import { afterEach, describe, expect, it, vi } from "vitest";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { MockDav } from "./migration/fs/webdav/mock.js";

afterEach(() => { vi.useRealTimers(); });

describe("WebDAV access path-limit compatibility", () => {
  it.each([1, 5])("preserves mode %s cancellation after public stat fulfillment", async mode => {
    const mock = new MockDav();
    mock.files.set("/directory", null);
    const caller = new AbortController();
    const remote = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: mock.fetch });
    const stat = remote.stat.bind(remote);
    vi.spyOn(remote, "stat").mockImplementation(async (...args) => {
      const result = await stat(...args);
      caller.abort(null);
      return result;
    });
    await expect(remote.access("/directory", mode, { signal: caller.signal })).rejects.toMatchObject({ code: "ECANCELED" });
    expect(mock.requests.map(request => request.headers.get("Depth"))).toEqual(["0"]);
  });

  it.each([0, 4])("keeps mode %s independent of stat and execute path limits", async mode => {
    const mock = new MockDav();
    const remote = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: mock.fetch });
    const deep = "/d".repeat(257);
    const long = "/" + "x".repeat(65_536);
    mock.files.set(deep, null);
    mock.files.set(long, new Uint8Array([1]));
    for (const path of ["/".repeat(65_537), "/.".repeat(257), deep, long]) {
      await expect(remote.access(path, mode)).resolves.toBeUndefined();
      const requests = mock.requests.length;
      await expect(remote.stat(path)).rejects.toMatchObject({ code: "ENAMETOOLONG" });
      await expect(remote.access(path, 1)).rejects.toMatchObject({ code: "ENAMETOOLONG" });
      await expect(remote.access(path, 5)).rejects.toMatchObject({ code: "ENAMETOOLONG" });
      expect(mock.requests).toHaveLength(requests);
    }
  });

  it.each([0, 4])("preserves mode %s collection suffix requirements", async mode => {
    const mock = new MockDav();
    mock.files.set("/file", new Uint8Array([1]));
    const remote = new WebDavFileSystem({ baseUrl: "https://example.invalid/dav/", fetch: mock.fetch });
    for (const path of ["/file/", "/file/."]) {
      await expect(remote.access(path, mode)).rejects.toMatchObject({ code: "ENOTDIR", syscall: "stat", path });
    }
    expect(mock.requests.every(request => request.init.method === "PROPFIND")).toBe(true);
  });

  it.each([0, 4])("retains the aggregate metadata-walk deadline for mode %s", async mode => {
    vi.useFakeTimers();
    const mock = new MockDav();
    mock.files.set("/directory", null);
    mock.files.set("/directory/child", null);
    const remote = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/", timeoutMs: 10,
      fetch: async (url, init) => {
        await new Promise(resolve => setTimeout(resolve, 6));
        return mock.fetch(url, init);
      }
    });
    const pending = remote.access("/directory/child/missing", mode).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ code: "ETIMEDOUT" });
    expect(mock.requests).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 4])("preserves caller cancellation during mode %s metadata lookup", async mode => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const reason = new Error("cancel access");
    const mock = new MockDav();
    const remote = new WebDavFileSystem({
      baseUrl: "https://example.invalid/dav/", timeoutMs: 10,
      fetch: async (url, init) => {
        await new Promise(resolve => setTimeout(resolve, 6));
        return mock.fetch(url, init);
      }
    });
    const pending = remote.access("/".repeat(65_537), mode, { signal: caller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(2);
    caller.abort(reason);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ code: "ECANCELED", cause: reason });
    expect(mock.requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

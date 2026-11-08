import { createHook } from "node:async_hooks";
import { getEventListeners } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FsError } from "../src/contracts/errors.js";
import { toByteSource } from "../src/contracts/io.js";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import type {
  WebDavAtomicEmptyDirectoryRequest,
  WebDavFileSystemOptions
} from "../src/fs/webdav/webdav.js";
import { MockDav } from "./migration/fs/webdav/mock.js";

const deadlineMs = 47_321;
const bytes = new Uint8Array([1, 2, 3]);

function observeDeadlines() {
  const timers = new Map<number, { destroyed: boolean; timer: WeakRef<NodeJS.Timeout> }>();
  const hook = createHook({
    init(identifier, type, _trigger, resource: NodeJS.Timeout & { _idleTimeout: number }) {
      if (type === "Timeout" && resource._idleTimeout === deadlineMs) {
        timers.set(identifier, { destroyed: false, timer: new WeakRef(resource) });
      }
    },
    destroy(identifier) {
      const timer = timers.get(identifier);
      if (timer) timer.destroyed = true;
    }
  });
  hook.enable();
  return {
    timers,
    stop() {
      hook.disable();
    },
    async released(expected: number) {
      await nextTurn();
      await nextTurn();
      expect(timers.size).toBe(expected);
      expect([...timers.values()].filter((timer) => !timer.destroyed)).toEqual([]);
    }
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function filesystem(options: Partial<WebDavFileSystemOptions> = {}) {
  return new WebDavFileSystem({
    baseUrl: "https://example.invalid/dav/",
    fetch: async () => new Response(bytes),
    timeoutMs: deadlineMs,
    ...options
  });
}

let observation: ReturnType<typeof observeDeadlines>;
beforeEach(() => {
  observation = observeDeadlines();
});
afterEach(() => {
  observation.stop();
  vi.restoreAllMocks();
});

describe("WebDAV operation-owned deadlines", () => {
  it.each(["success", "transport", "body"] as const)(
    "disposes a retained request signal after %s",
    async (mode) => {
      const primary = new Error("original failure");
      const mock = new MockDav();
      mock.files.set("/file", bytes);
      let signal!: AbortSignal;
      const remote = filesystem({
        fetch: async (url, init) => {
          if (init.method === "PROPFIND") return mock.fetch(url, init);
          signal = init.signal!;
          expect(
            [...observation.timers.values()].every(
              (timer) => timer.timer.deref()?.hasRef() === false
            )
          ).toBe(true);
          if (mode === "transport") throw primary;
          if (mode === "body")
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(primary);
                }
              })
            );
          return new Response(bytes);
        }
      });
      if (mode === "success") expect(await remote.readFile("/file")).toEqual(bytes);
      else
        await expect(remote.readFile("/file")).rejects.toMatchObject({
          code: "EIO",
          cause: primary
        });
      expect(signal.aborted).toBe(false);
      expect(getEventListeners(signal, "abort")).toEqual([]);
      await observation.released(2);
    }
  );

  it("keeps a streaming deadline until iterator return and then disposes it", async () => {
    const cancel = vi.fn();
    const mock = new MockDav();
    mock.files.set("/file", bytes);
    let signal!: AbortSignal;
    const remote = filesystem({
      fetch: async (url, init) => {
        if (init.method === "PROPFIND") return mock.fetch(url, init);
        signal = init.signal!;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
            },
            cancel
          })
        );
      }
    });
    const reader = remote.readStream("/file")[Symbol.asyncIterator]();
    try {
      expect(await reader.next()).toMatchObject({ done: false, value: bytes });
      await nextTurn();
      await nextTurn();
      expect([...observation.timers.values()].filter((timer) => !timer.destroyed)).toHaveLength(1);
    } finally {
      await reader.return?.(undefined);
    }
    expect(signal.aborted).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    await observation.released(2);
  });

  it("disposes cancellation before a late response without losing body cleanup", async () => {
    const caller = new AbortController();
    const reason = new Error("caller cancellation");
    const entered = deferred<AbortSignal>();
    const response = deferred<Response>();
    const cancel = vi.fn();
    const remote = filesystem({
      fetch: async (_url, init) => {
        entered.resolve(init.signal!);
        return response.promise;
      }
    });
    const pending = remote.readFile("/file", { signal: caller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ code: "ECANCELED", cause: reason });
    const signal = await entered.promise;
    caller.abort(reason);
    await rejection;
    await observation.released(1);
    response.resolve(new Response(new ReadableStream({ cancel })));
    await nextTurn();
    expect(signal.reason).toBe(reason);
    expect(cancel).toHaveBeenCalledOnce();
    expect(getEventListeners(caller.signal, "abort")).toEqual([]);
  });

  it("releases header setup failure without wrapping its original error", async () => {
    const primary = new Error("headers iteration failed");
    const fetch = vi.fn(async () => new Response(bytes));
    const remote = filesystem({ fetch });
    const headers = Reflect.get(remote, "headers") as Headers;
    vi.spyOn(headers, Symbol.iterator).mockImplementation(() => {
      throw primary;
    });
    await expect(remote.readFile("/file")).rejects.toBe(primary);
    expect(fetch).not.toHaveBeenCalled();
    await observation.released(1);
  });

  it.each(["request", "upload"] as const)(
    "releases %s signal setup failure before dispatch or acquisition",
    async (mode) => {
      const caller = new AbortController();
      const primary = new Error("signal registration failed");
      vi.spyOn(caller.signal, "addEventListener").mockImplementation(() => {
        throw primary;
      });
      const fetch = vi.fn(async () => new Response(bytes));
      const acquire = vi.fn(() => toByteSource(bytes)[Symbol.asyncIterator]());
      const remote = filesystem({ fetch, requestStreamSupport: true });
      const pending =
        mode === "request"
          ? remote.readFile("/file", { signal: caller.signal })
          : remote.writeStream(
              "/file",
              { [Symbol.asyncIterator]: acquire },
              { flag: "wx", signal: caller.signal }
            );
      await expect(pending).rejects.toBe(primary);
      expect(fetch).not.toHaveBeenCalled();
      expect(acquire).not.toHaveBeenCalled();
      await observation.released(1);
    }
  );

  it.each(["success", "source", "early-response", "cancel"] as const)(
    "releases both upload deadlines after %s",
    async (mode) => {
      const caller = new AbortController();
      const primary = new FsError("EFBIG", { message: "original source failure" });
      const cancellation = new Error("caller wins");
      const close = vi.fn(async () => {
        throw new Error("secondary cleanup");
      });
      let step = 0;
      const acquire = vi.fn(() => ({
        async next() {
          if (mode === "source") throw primary;
          if (mode === "cancel") {
            caller.abort(cancellation);
            throw primary;
          }
          return step++ === 0
            ? { done: false as const, value: bytes }
            : { done: true as const, value: undefined };
        },
        return: close
      }));
      let signal!: AbortSignal;
      const remote = filesystem({
        requestStreamSupport: true,
        fetch: async (_url, init) => {
          signal = init.signal!;
          expect(observation.timers.size).toBe(2);
          expect(acquire).not.toHaveBeenCalled();
          if (mode !== "early-response") await new Response(init.body).arrayBuffer();
          return new Response(null, { status: 201 });
        }
      });
      const pending = remote.writeStream(
        "/file",
        { [Symbol.asyncIterator]: acquire },
        { flag: "wx", signal: caller.signal }
      );
      if (mode === "success") await pending;
      else if (mode === "source") await expect(pending).rejects.toBe(primary);
      else if (mode === "cancel") {
        await expect(pending).rejects.toMatchObject({ code: "ECANCELED" });
        expect(caller.signal.reason).toBe(cancellation);
      } else await expect(pending).rejects.toMatchObject({ code: "EIO" });
      expect(signal.aborted).toBe(mode === "cancel");
      expect(acquire).toHaveBeenCalledTimes(mode === "early-response" ? 0 : 1);
      expect(close).toHaveBeenCalledTimes(mode === "source" || mode === "cancel" ? 1 : 0);
      await observation.released(2);
    }
  );

  it.each(["unsupported", "pre-aborted"] as const)(
    "preserves %s priority without allocating deadlines",
    async (mode) => {
      const caller = new AbortController();
      if (mode === "pre-aborted") caller.abort(new Error("already aborted"));
      const fetch = vi.fn(async () => new Response(bytes));
      const acquire = vi.fn(() => toByteSource(bytes)[Symbol.asyncIterator]());
      const remote = filesystem({ fetch, requestStreamSupport: false });
      await expect(
        remote.writeStream("/file", { [Symbol.asyncIterator]: acquire }, { signal: caller.signal })
      ).rejects.toMatchObject({ code: mode === "pre-aborted" ? "ECANCELED" : "ENOTSUP" });
      expect(fetch).not.toHaveBeenCalled();
      expect(acquire).not.toHaveBeenCalled();
      await observation.released(0);
    }
  );

  it.each(["success", "receipt", "reject", "cancel", "setup"] as const)(
    "disposes atomic rmdir deadlines after %s",
    async (mode) => {
      const caller = new AbortController();
      const primary = new Error("atomic primary");
      const mock = new MockDav();
      mock.files.set("/directory", null);
      let request: WebDavAtomicEmptyDirectoryRequest | undefined;
      const remove = vi.fn(async (input: WebDavAtomicEmptyDirectoryRequest) => {
        request = input;
        if (mode === "reject") throw primary;
        if (mode === "cancel") {
          caller.abort(primary);
          throw new Error("secondary");
        }
        return {
          ...input,
          outcome: "removed" as const,
          path: mode === "receipt" ? "/wrong" : input.path
        };
      });
      const remote = filesystem({
        fetch: async (url, init) => {
          const response = await mock.fetch(url, init);
          if (mode === "setup")
            vi.spyOn(caller.signal, "addEventListener").mockImplementation(() => {
              throw primary;
            });
          return response;
        },
        atomicEmptyDirectory: {
          namespaceUrl: "https://example.invalid/dav/",
          removeEmptyDirectory: remove
        }
      });
      const pending = remote.rmdir("/directory", { signal: caller.signal });
      if (mode === "success") await pending;
      else if (mode === "setup") await expect(pending).rejects.toBe(primary);
      else
        await expect(pending).rejects.toMatchObject({
          code: mode === "cancel" ? "ECANCELED" : "EIO"
        });
      expect(remove).toHaveBeenCalledTimes(mode === "setup" ? 0 : 1);
      if (request) expect(request.signal?.aborted).toBe(mode === "cancel");
      expect(getEventListeners(caller.signal, "abort")).toEqual([]);
      await observation.released(2);
    }
  );

  it.each(["request", "upload", "atomic"] as const)(
    "keeps a held %s bounded with a genuine TimeoutError",
    async (mode) => {
      const mock = new MockDav();
      mock.files.set("/directory", null);
      let signal!: AbortSignal;
      const hold = (input: AbortSignal) => {
        signal = input;
        return new Promise<never>(() => {});
      };
      const remote = filesystem({
        timeoutMs: 20,
        requestStreamSupport: true,
        fetch: (url, init) => (mode === "atomic" ? mock.fetch(url, init) : hold(init.signal!)),
        atomicEmptyDirectory: {
          namespaceUrl: "https://example.invalid/dav/",
          removeEmptyDirectory: async (input) => hold(input.signal!)
        }
      });
      const wait = setTimeout(() => {}, 1000);
      try {
        const pending =
          mode === "request"
            ? remote.readFile("/file")
            : mode === "upload"
              ? remote.writeStream("/file", toByteSource(bytes), { flag: "wx" })
              : remote.rmdir("/directory");
        await expect(pending).rejects.toMatchObject({ code: "ETIMEDOUT" });
        expect(signal.reason).toBeInstanceOf(DOMException);
        expect(signal.reason).toMatchObject({
          name: "TimeoutError",
          message: "The operation was aborted due to timeout"
        });
      } finally {
        clearTimeout(wait);
      }
    }
  );

  it("preserves caller cancellation when the deadline abort handler cancels the caller", async () => {
    const caller = new AbortController();
    const primary = new Error("caller primary");
    let signal!: AbortSignal;
    const remote = filesystem({
      timeoutMs: 20,
      fetch: async (_url, init) => {
        signal = init.signal!;
        signal.addEventListener("abort", () => caller.abort(primary), { once: true });
        return new Promise<Response>(() => {});
      }
    });
    const wait = setTimeout(() => {}, 1000);
    try {
      await expect(remote.readFile("/file", { signal: caller.signal })).rejects.toMatchObject({
        code: "ECANCELED"
      });
      expect(caller.signal.reason).toBe(primary);
      expect(signal.reason).toBeInstanceOf(DOMException);
      expect(getEventListeners(caller.signal, "abort")).toEqual([]);
    } finally {
      clearTimeout(wait);
    }
  });
});

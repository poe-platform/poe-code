import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { FsError, MemoryFileSystem, MountFileSystem, OverlayFileSystem, RealFileSystem, readBytes } from "../src/index.js";
import type { ByteSource } from "../src/index.js";

const nativeFailures = vi.hoisted(() => ({
  read: undefined as unknown,
  close: undefined as unknown,
  onRead: undefined as (() => void) | undefined,
  closes: 0
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  const promises = {
    ...fs.promises,
    async open(filename: string, flags: number, mode?: number) {
      const handle = await fs.promises.open(filename, flags, mode);
      const read = handle.read.bind(handle);
      const close = handle.close.bind(handle);
      handle.read = async (buffer, offset, length, position) => {
        nativeFailures.onRead?.();
        if (nativeFailures.read !== undefined) throw nativeFailures.read;
        return read(buffer, offset, length, position);
      };
      handle.close = async () => {
        nativeFailures.closes++;
        await close();
        if (nativeFailures.close !== undefined) throw nativeFailures.close;
      };
      return handle;
    }
  };
  return { ...promises, default: promises };
});

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { constants: fs.constants };
});

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/file": "bytes" });
  nativeFailures.read = undefined;
  nativeFailures.close = undefined;
  nativeFailures.onRead = undefined;
  nativeFailures.closes = 0;
});

afterEach(() => { vi.restoreAllMocks(); });

function sourceWithCleanup(cleanup: () => Promise<IteratorResult<Uint8Array>>) {
  const cleanupCall = vi.fn(cleanup);
  const iterator: AsyncIterator<Uint8Array> = {
    next: async () => ({ done: false, value: new Uint8Array([1]) }),
    return: cleanupCall
  };
  const source: ByteSource = { [Symbol.asyncIterator]: () => iterator };
  return { source, iterator, cleanupCall };
}

describe("byte iterator cleanup precedence", () => {
  it("preserves a successful early-return value and returns the source once", async () => {
    const { source, cleanupCall } = sourceWithCleanup(async () => ({ done: true, value: undefined }));
    const iterator = readBytes(source);
    await iterator.next();
    await expect(iterator.return("finished")).resolves.toEqual({ done: true, value: "finished" });
    expect(cleanupCall).toHaveBeenCalledOnce();
  });

  it("surfaces cleanup rejection on normal early return", async () => {
    const failure = new Error("cleanup");
    const { source, cleanupCall } = sourceWithCleanup(async () => { throw failure; });
    const iterator = readBytes(source);
    await iterator.next();
    await expect(iterator.return(undefined)).rejects.toBe(failure);
    expect(cleanupCall).toHaveBeenCalledOnce();
  });

  it.each([new Error("primary"), undefined, null])("retains a source failure over cleanup failure: %s", async (primary) => {
    const { source, iterator, cleanupCall } = sourceWithCleanup(async () => { throw new Error("cleanup"); });
    iterator.next = async () => { throw primary; };
    await expect(readBytes(source).next()).rejects.toBe(primary);
    expect(cleanupCall).toHaveBeenCalledOnce();
  });

  it("retains an injected throw over a cleanup failure", async () => {
    const primary = new Error("consumer throw");
    const { source, cleanupCall } = sourceWithCleanup(async () => { throw new Error("cleanup"); });
    const iterator = readBytes(source);
    await iterator.next();
    await expect(iterator.throw(primary)).rejects.toBe(primary);
    expect(cleanupCall).toHaveBeenCalledOnce();
  });

  it("retains cancellation identity without waiting for pending cleanup", async () => {
    const controller = new AbortController();
    const reason = { cancelled: true };
    let rejectCleanup!: (error: unknown) => void;
    const cleanup = new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => { rejectCleanup = reject; });
    const { source, iterator, cleanupCall } = sourceWithCleanup(() => cleanup);
    iterator.next = async () => { controller.abort(reason); throw new Error("read failed"); };
    await expect(readBytes(source, controller.signal).next()).rejects.toBe(reason);
    expect(cleanupCall).toHaveBeenCalledOnce();
    rejectCleanup(new Error("late cleanup"));
    await Promise.resolve();
  });
});

describe("RealFileSystem read-stream cleanup", () => {
  it("preserves normal iterator return and closes exactly once", async () => {
    const iterator = new RealFileSystem({ root: "/machine" }).readStream("/file")[Symbol.asyncIterator]();
    await iterator.next();
    await expect(iterator.return!("finished")).resolves.toEqual({ done: true, value: "finished" });
    expect(nativeFailures.closes).toBe(1);
  });

  it.each(["exhaustion", "return"] as const)("reports a close failure after successful %s", async (ending) => {
    nativeFailures.close = Object.assign(new Error("close"), { code: "ENOSPC" });
    const iterator = new RealFileSystem({ root: "/machine" }).readStream("/file")[Symbol.asyncIterator]();
    await iterator.next();
    const completed = ending === "return" ? iterator.return!(undefined) : iterator.next();
    await expect(completed).rejects.toMatchObject({ code: "ENOSPC", syscall: "readStream", path: "/file" });
    expect(nativeFailures.closes).toBe(1);
  });

  it("does not mask a read failure with a close failure", async () => {
    nativeFailures.read = Object.assign(new Error("read"), { code: "EACCES" });
    nativeFailures.close = Object.assign(new Error("close"), { code: "ENOSPC" });
    const iterator = new RealFileSystem({ root: "/machine" }).readStream("/file")[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: "EACCES", syscall: "readStream", path: "/file" });
    expect(nativeFailures.closes).toBe(1);
  });

  it("does not mask cancellation reason with a close failure", async () => {
    const controller = new AbortController();
    const reason = { cancelled: true };
    nativeFailures.onRead = () => controller.abort(reason);
    nativeFailures.close = Object.assign(new Error("close"), { code: "ENOSPC" });
    const iterator = new RealFileSystem({ root: "/machine" }).readStream("/file", { signal: controller.signal })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBe(reason);
    expect(nativeFailures.closes).toBe(1);
  });

  it("retains an injected consumer error over a close failure", async () => {
    nativeFailures.close = Object.assign(new Error("close"), { code: "ENOSPC" });
    const iterator = new RealFileSystem({ root: "/machine" }).readStream("/file")[Symbol.asyncIterator]();
    await iterator.next();
    await expect(iterator.throw!(new FsError("EACCES"))).rejects.toMatchObject({ code: "EACCES", syscall: "readStream", path: "/file" });
    expect(nativeFailures.closes).toBe(1);
  });
});

describe.each(["success", "failure"] as const)("wrapper cleanup after writer %s", (outcome) => {
  it("preserves mount copy failure precedence and always returns the source", async () => {
    const reader = new MemoryFileSystem();
    const writer = new MemoryFileSystem();
    const primary = new FsError("EACCES");
    const cleanup = new FsError("ENOSPC");
    const { source, cleanupCall } = sourceWithCleanup(async () => { throw cleanup; });
    await reader.writeFile("/file", new Uint8Array([1]));
    reader.readStream = () => source;
    writer.writeStream = async (_path, input) => {
      await input[Symbol.asyncIterator]().next();
      if (outcome === "failure") throw primary;
    };
    const filesystem = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/from": reader, "/to": writer } });
    await expect(filesystem.copyFile("/from/file", "/to/file")).rejects.toMatchObject({
      code: outcome === "failure" ? "EACCES" : "ENOSPC",
      cause: outcome === "failure" ? primary : cleanup
    });
    expect(cleanupCall).toHaveBeenCalledOnce();
  });

  it("preserves overlay write failure precedence and always returns the source", async () => {
    const upper = new MemoryFileSystem();
    const primary = new FsError("EACCES");
    const cleanup = new FsError("ENOSPC");
    const { source, cleanupCall } = sourceWithCleanup(async () => { throw cleanup; });
    upper.writeStream = async (_path, input) => {
      await input[Symbol.asyncIterator]().next();
      if (outcome === "failure") throw primary;
    };
    const filesystem = new OverlayFileSystem({ upper, lower: new MemoryFileSystem() });
    await expect(filesystem.writeStream("/file", source)).rejects.toBe(outcome === "failure" ? primary : cleanup);
    expect(cleanupCall).toHaveBeenCalledOnce();
  });
});

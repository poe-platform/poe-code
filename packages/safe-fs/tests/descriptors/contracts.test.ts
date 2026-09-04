import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { FsError, isErrnoCode } from "../../src/contracts/errors.js";
import type { FileDescriptor, FileDescriptorCapabilities, FileStat, FileSystem, OpenFileOptions } from "../../src/contracts/filesystem.js";
import { openFileDescriptor, type DescriptorBackend, type DescriptorOpenOptions } from "../../src/fs/descriptor.js";

const capabilities: FileDescriptorCapabilities = {
  positionedRead: true, positionedWrite: true, truncate: true, synchronization: "volatile",
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((fulfilled, rejected) => { resolve = fulfilled; reject = rejected; });
  return { promise, resolve, reject };
}

function fixture() {
  const fs = createFsFromVolume(Volume.fromJSON({ "/file": "abcdef" }));
  const events: string[] = [];
  const resource = { descriptor: -1, position: 0 };
  let request: DescriptorOpenOptions | undefined;
  const backend: DescriptorBackend<typeof resource> = {
    resource,
    async stat(current) {
      events.push("stat");
      const stat = fs.fstatSync(current.descriptor);
      return { type: "file", size: Number(stat.size), mode: Number(stat.mode),
        atimeMs: Number(stat.atimeMs), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs) };
    },
    async read(current, buffer, position) {
      events.push("read");
      const count = fs.readSync(current.descriptor, buffer, 0, buffer.byteLength, position ?? current.position);
      if (position === null) current.position += count;
      return count;
    },
    async write(current, buffer, position) {
      events.push("write");
      const offset = request!.append ? Number(fs.fstatSync(current.descriptor).size) : position ?? current.position;
      const count = fs.writeSync(current.descriptor, buffer, 0, buffer.byteLength, offset);
      if (position === null) current.position = offset + count;
      return count;
    },
    async truncate(current, length) { events.push("truncate"); fs.ftruncateSync(current.descriptor, length); },
    async sync(_current, dataOnly) { events.push(dataOnly ? "dataSync" : "sync"); },
    async close(current) { events.push("close"); fs.closeSync(current.descriptor); },
  };
  return {
    fs, events, backend, request: () => request,
    async acquire(options: DescriptorOpenOptions) {
      events.push("acquire");
      request = options;
      resource.descriptor = fs.openSync("/file", options.append ? "a+" : "r+");
      return backend;
    },
  };
}

describe("optional canonical descriptor contract", () => {
  it("validates the admitted option snapshot before any acquisition", async () => {
    const setup = fixture();
    let observations = 0;
    const options: OpenFileOptions = { access: "write", get truncate() { return ++observations <= 2; } };
    await expect(openFileDescriptor("/file", options, { ...capabilities, truncate: false }, setup.acquire)).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(setup.events).toEqual([]);
  });

  it("takes one capability snapshot for validation and publication", async () => {
    const setup = fixture();
    let observations = 0;
    const declared = { ...capabilities, get truncate() { return ++observations === 1; } };
    const handle = await openFileDescriptor("/file", { access: "write", truncate: true }, declared, setup.acquire);
    expect(handle.capabilities.truncate).toBe(true);
    expect(observations).toBe(1);
    await handle.close();
  });

  it("keeps open optional and exports descriptor types through the existing contract", () => {
    expectTypeOf<FileSystem["open"]>().toEqualTypeOf<((path: string, options: OpenFileOptions) => Promise<FileDescriptor>) | undefined>();
    expectTypeOf<FileDescriptor["stat"]>().returns.resolves.toEqualTypeOf<FileStat>();
    expect(isErrnoCode("ESPIPE")).toBe(true);
    expect(new FsError("ESPIPE").code).toBe("ESPIPE");
  });

  it("normalizes and snapshots open options before acquisition", async () => {
    const setup = fixture();
    const options: OpenFileOptions = { access: "readwrite" };
    const handle = await openFileDescriptor("/file", options, capabilities, setup.acquire);
    expect(setup.request()).toEqual({ access: "readwrite", creation: "never", truncate: false, append: false, mode: 0o666 });
    expect(Object.isFrozen(setup.request())).toBe(true);
    expect(Object.isFrozen(handle.capabilities)).toBe(true);
    expect(handle.capabilities.synchronization).toBe("volatile");
    await handle.close();
  });

  it("keeps access and capability admission independent of later caller mutations", async () => {
    const setup = fixture();
    const options: OpenFileOptions = { access: "read" };
    const declared = { ...capabilities };
    const handle = await openFileDescriptor("/file", options, declared, setup.acquire);
    Object.assign(options, { access: "readwrite" });
    Object.assign(declared, { synchronization: "storage" });
    await expect(handle.write(new Uint8Array(1), 0)).rejects.toMatchObject({ code: "EBADF" });
    expect(handle.capabilities.synchronization).toBe("volatile");
    await handle.close();
  });

  it("leaves filesystem permission authorization at acquisition, not later pathname access", async () => {
    const setup = fixture();
    const denial = new FsError("EACCES");
    await expect(openFileDescriptor("/file", { access: "read" }, capabilities, async () => { throw denial; })).rejects.toBe(denial);
    expect(setup.events).toEqual([]);
    const handle = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, setup.acquire);
    setup.fs.chmodSync("/file", 0);
    setup.fs.unlinkSync("/file");
    const buffer = new Uint8Array(1);
    expect(await handle.read(buffer, 0)).toBe(1);
    expect(await handle.write(new Uint8Array([88]), 0)).toBe(1);
    expect((await handle.stat()).size).toBe(6);
    await handle.close();
  });

  it("does not retain the acquisition signal as an implicit descriptor-lifetime signal", async () => {
    const setup = fixture();
    const controller = new AbortController();
    const handle = await openFileDescriptor("/file", { access: "read", signal: controller.signal }, capabilities, setup.acquire);
    controller.abort(0);
    expect(await handle.read(new Uint8Array(1), 0)).toBe(1);
    await expect(handle.read(new Uint8Array(1), 0, { signal: controller.signal })).rejects.toBe(0);
    await handle.close();
  });

  it("empty buffers return zero without dispatching I/O while access checks still apply", async () => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, setup.acquire);
    expect(await handle.read(new Uint8Array(), null)).toBe(0);
    expect(await handle.write(new Uint8Array(), null)).toBe(0);
    expect(setup.events).toEqual(["acquire"]);
    await handle.close();
    await expect(handle.write(new Uint8Array(), null)).rejects.toMatchObject({ code: "EBADF" });
  });

  it.each([
    { access: "invalid" }, { access: "read", truncate: true }, { access: "read", append: true },
    { access: "write", creation: "invalid" }, { access: "write", truncate: "yes" },
    { access: "write", append: 1 }, { access: "write", mode: -1 }, { access: "write", mode: 0o10000 },
    { access: "write", synchronization: "invalid" }, { access: "write", flags: ["direct"] },
    { access: "write", creation: null }, { access: "write", truncate: null },
    { access: "write", append: null }, { access: "write", mode: null },
  ])("rejects invalid or unknown open options before acquisition: %j", async options => {
    const setup = fixture();
    await expect(openFileDescriptor("/file", options as unknown as OpenFileOptions, capabilities, setup.acquire)).rejects.toMatchObject({ code: "EINVAL" });
    expect(setup.events).toEqual([]);
  });

  it("rejects unavailable truncation and synchronization before acquisition", async () => {
    const setup = fixture();
    await expect(openFileDescriptor("/file", { access: "write", truncate: true }, { ...capabilities, truncate: false }, setup.acquire)).rejects.toMatchObject({ code: "ENOTSUP" });
    await expect(openFileDescriptor("/file", { access: "write", synchronization: "all" }, { ...capabilities, synchronization: "none" }, setup.acquire)).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(setup.events).toEqual([]);
  });

  it.each(["read", "write"] as const)("enforces acquired %s access independently of the underlying resource", async access => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access }, capabilities, setup.acquire);
    if (access === "read") {
      await expect(handle.write(new Uint8Array([88]), 0)).rejects.toMatchObject({ code: "EBADF" });
      await expect(handle.truncate(0)).rejects.toMatchObject({ code: "EBADF" });
      expect(handle.capabilities.positionedWrite).toBe(false);
      expect(handle.capabilities.truncate).toBe(false);
    } else {
      await expect(handle.read(new Uint8Array(1), 0)).rejects.toMatchObject({ code: "EBADF" });
      expect(handle.capabilities.positionedRead).toBe(false);
    }
    expect(setup.events).toEqual(["acquire"]);
    await handle.close();
  });

  it("returns partial byte counts and borrows the exact buffer view only until settlement", async () => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, setup.acquire);
    const storage = new Uint8Array([9, 9, 9, 9, 9, 9]);
    const view = storage.subarray(1, 5);
    setup.backend.read = async (_resource, buffer) => {
      expect(buffer).toBe(view);
      buffer.set([0, 255]);
      return 2;
    };
    expect(await handle.read(view, 0)).toBe(2);
    expect(storage).toEqual(new Uint8Array([9, 0, 255, 9, 9, 9]));
    setup.backend.write = async (_resource, buffer) => { expect(buffer).toBe(view); return 1; };
    expect(await handle.write(view, 0)).toBe(1);
    await handle.close();
  });

  it("positioned operations leave the sequential cursor unchanged and truncation retains the object", async () => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, setup.acquire);
    const first = new Uint8Array(2), positioned = new Uint8Array(2), next = new Uint8Array(2);
    expect(await handle.read(first, null)).toBe(2);
    expect(await handle.read(positioned, 4)).toBe(2);
    expect(await handle.read(next, null)).toBe(2);
    expect(new TextDecoder().decode(first)).toBe("ab");
    expect(new TextDecoder().decode(positioned)).toBe("ef");
    expect(new TextDecoder().decode(next)).toBe("cd");
    setup.fs.renameSync("/file", "/renamed");
    expect(await handle.write(new Uint8Array([88]), 1)).toBe(1);
    await handle.truncate(3);
    expect(setup.fs.readFileSync("/renamed", "utf8")).toBe("aXc");
    expect((await handle.stat()).size).toBe(3);
    await handle.close();
  });

  it("append refuses numeric positions and never advertises positioned writing", async () => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access: "write", append: true }, capabilities, setup.acquire);
    expect(handle.capabilities.positionedWrite).toBe(false);
    await expect(handle.write(new Uint8Array([88]), 0)).rejects.toMatchObject({ code: "EINVAL" });
    expect(await handle.write(new Uint8Array([88]), null)).toBe(1);
    expect(setup.fs.readFileSync("/file", "utf8")).toBe("abcdefX");
    await handle.close();
  });

  it("nonseekable operations use ESPIPE without touching the backend", async () => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access: "readwrite" }, { ...capabilities, positionedRead: false, positionedWrite: false }, setup.acquire);
    await expect(handle.read(new Uint8Array(1), 0)).rejects.toMatchObject({ code: "ESPIPE" });
    await expect(handle.write(new Uint8Array(1), 0)).rejects.toMatchObject({ code: "ESPIPE" });
    expect(setup.events).toEqual(["acquire"]);
    await handle.close();
  });

  it("checks offsets and returned counts, without retrying or treating errors as EOF", async () => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, setup.acquire);
    for (const position of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(handle.read(new Uint8Array(1), position)).rejects.toMatchObject({ code: "EINVAL" });
      await expect(handle.truncate(position)).rejects.toMatchObject({ code: "EINVAL" });
    }
    for (const count of [-1, 0.5, 3, NaN]) {
      setup.backend.read = async () => count;
      setup.backend.write = async () => count;
      await expect(handle.read(new Uint8Array(2), 0)).rejects.toMatchObject({ code: "EIO" });
      await expect(handle.write(new Uint8Array(2), 0)).rejects.toMatchObject({ code: "EIO" });
    }
    const failure = new FsError("EIO");
    setup.backend.read = async () => { throw failure; };
    await expect(handle.read(new Uint8Array(1), 0)).rejects.toBe(failure);
    setup.backend.read = async () => 0;
    expect(await handle.read(new Uint8Array(1), 0)).toBe(0);
    await handle.close();
  });

  it("forwards data/full synchronization without presenting volatile storage as durable", async () => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access: "write", synchronization: "data" }, capabilities, setup.acquire);
    await handle.sync(true);
    await handle.sync(false);
    expect(setup.events).toEqual(["acquire", "dataSync", "sync"]);
    expect(handle.capabilities.synchronization).toBe("volatile");
    await handle.close();
  });

  it("close stops new admission immediately, drains queued work and releases exactly once", async () => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, setup.acquire);
    const started = deferred<void>(), release = deferred<number>();
    setup.backend.write = async () => { setup.events.push("writeStarted"); started.resolve(); return release.promise; };
    const writing = handle.write(new Uint8Array(1), null);
    const statting = handle.stat();
    await started.promise;
    const closing = handle.close();
    expect(handle.close()).toBe(closing);
    await expect(handle.read(new Uint8Array(1), 0)).rejects.toMatchObject({ code: "EBADF" });
    expect(setup.events).toEqual(["acquire", "writeStarted"]);
    release.resolve(1);
    expect(await writing).toBe(1);
    await statting;
    await closing;
    expect(setup.events).toEqual(["acquire", "writeStarted", "stat", "close"]);
    await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
  });

  it.each([0, false, null])("pre-aborted acquisition preserves %j without admitting resources", async reason => {
    const setup = fixture();
    const controller = new AbortController();
    controller.abort(reason);
    await expect(openFileDescriptor("/file", { access: "read", signal: controller.signal }, capabilities, setup.acquire)).rejects.toBe(reason);
    expect(setup.events).toEqual([]);
  });

  it("a canceled late acquisition is closed before rejection, preserving cancellation over close failure", async () => {
    const setup = fixture();
    const acquired = deferred<void>(), admitted = deferred<typeof setup.backend>();
    const controller = new AbortController();
    const opening = openFileDescriptor("/file", { access: "read", signal: controller.signal }, capabilities, async options => {
      const backend = await setup.acquire(options);
      acquired.resolve();
      await admitted.promise;
      return backend;
    });
    await acquired.promise;
    const closing = setup.backend.close;
    setup.backend.close = async resource => { await closing(resource); throw new Error("secondary close failure"); };
    controller.abort(0);
    admitted.resolve(setup.backend);
    await expect(opening).rejects.toBe(0);
    expect(setup.events).toEqual(["acquire", "close"]);
  });

  it("canceled active buffer work settles before rejection; canceled queued work is never dispatched", async () => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, setup.acquire);
    const started = deferred<void>(), release = deferred<void>();
    const active = new AbortController(), queued = new AbortController();
    const buffer = new Uint8Array(1);
    let settled = false;
    setup.backend.read = async (_resource, target) => { started.resolve(); await release.promise; target[0] = 65; return 1; };
    const reading = handle.read(buffer, 0, { signal: active.signal });
    void reading.then(() => { settled = true; }, () => { settled = true; });
    const writing = handle.write(new Uint8Array([88]), 0, { signal: queued.signal });
    await started.promise;
    active.abort(false);
    queued.abort(null);
    await Promise.resolve();
    expect(settled).toBe(false);
    const rejectedRead = expect(reading).rejects.toBe(false);
    const rejectedWrite = expect(writing).rejects.toBe(null);
    release.resolve();
    await rejectedRead;
    await rejectedWrite;
    expect(buffer[0]).toBe(65);
    expect(setup.events).not.toContain("write");
    await handle.close();
  });

  it("failed close is idempotent and permanently denies resource reuse", async () => {
    const setup = fixture();
    const handle = await openFileDescriptor("/file", { access: "readwrite" }, capabilities, setup.acquire);
    const release = setup.backend.close;
    const failure = new FsError("EIO");
    setup.backend.close = async resource => { await release(resource); throw failure; };
    const closing = handle.close();
    await expect(closing).rejects.toBe(failure);
    expect(handle.close()).toBe(closing);
    await expect(handle.sync(false)).rejects.toMatchObject({ code: "EBADF" });
    expect(setup.events).toEqual(["acquire", "close"]);
  });
});

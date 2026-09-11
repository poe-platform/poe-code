import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import type { FileResizeHandle, FileStat, FileSystem, FileSystemCapabilities } from "../src/contracts/filesystem.js";
import { FsError } from "../src/contracts/errors.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { RealFileSystem } from "../src/fs/real/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { bridgeStats } from "../src/bridge/stats.js";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { MockS3Client } from "../src/fs/s3/mock.js";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { MockDav } from "./migration/fs/webdav/mock.js";
import { capturePathNamespace, pathNamespace } from "../src/fs/path-namespace.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { constants: fs.constants };
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe("Device metadata getter cancellation", () => {
  it.each(["lstat", "readlink"] as const)("captures generic-resolution %s without a canceled second lookup dispatch", async method => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", Uint8Array.of(1));
    await memory.symlink("file", "/alias");
    const controller = new AbortController();
    let lookups = 0;
    let lateCalls = 0;
    const original = memory[method];
    const overrides = {};
    Object.defineProperty(overrides, method, { get() {
      if (++lookups === 2) controller.abort(false);
      return (...args: unknown[]) => {
        if (controller.signal.aborted) lateCalls++;
        return Reflect.apply(original, memory, args);
      };
    } });
    const devices = new DeviceFileSystem(view(memory, overrides));
    const result = await devices.capabilitiesFor("/alias", { signal: controller.signal }).then(value => ({ value }), error => ({ error }));
    expect(lateCalls).toBe(0);
    if (controller.signal.aborted) expect(result).toEqual({ error: false });
    else expect(result).toHaveProperty("value.retainedResize", true);
  });

  it.each(["capabilitiesFor", "stat", "lstat"] as const)("does not dispatch %s after its backend getter aborts", async method => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", Uint8Array.of(1));
    const controller = new AbortController();
    let armed = false;
    const callback = vi.fn(async () => method === "capabilitiesFor" ? memory.capabilities : memory.stat("/file"));
    const overrides = {};
    Object.defineProperty(overrides, method, { get() {
      if (armed) controller.abort(false);
      return callback;
    } });
    const devices = new DeviceFileSystem(view(memory, overrides));
    const execute = devices[method];
    armed = true;
    await expect(execute("/file", { signal: controller.signal })).rejects.toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it.each(["stat", "access", "lstat", "readlink"] as const)("does not dispatch creation-path %s after getter cancellation", async method => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", Uint8Array.of(1));
    await memory.symlink("file", "/alias");
    const controller = new AbortController();
    const callback = vi.fn();
    const overrides = {};
    Object.defineProperty(overrides, method, { get() { controller.abort(false); return callback; } });
    const devices = new DeviceFileSystem(view(memory, overrides));
    await expect(devices.capabilitiesFor("/alias", { create: true, signal: controller.signal })).rejects.toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it("preserves abort from an absent query getter rather than using fallback capabilities", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", Uint8Array.of(1));
    const controller = new AbortController();
    let armed = false;
    const overrides = {};
    Object.defineProperty(overrides, "capabilitiesFor", { get() { if (armed) controller.abort(false); return undefined; } });
    const devices = new DeviceFileSystem(view(memory, overrides));
    const query = devices.capabilitiesFor;
    armed = true;
    await expect(query("/file", { signal: controller.signal })).rejects.toBe(false);
  });
});

describe("ReadOnly namespace authority", () => {
  it("preserves complete symbol absence when the backing filesystem has no namespace", () => {
    const memory = new MemoryFileSystem();
    expect(Reflect.has(memory, pathNamespace)).toBe(false);
    const readonly = new ReadOnlyFileSystem(memory);
    expect(Reflect.ownKeys(readonly)).toEqual([]);
    expect(Reflect.has(readonly, pathNamespace)).toBe(false);
    expect(capturePathNamespace(readonly, {})).toBeUndefined();
  });

  it("exposes only a detached frozen selector, not metadata or callback delegate/native fields", () => {
    const memory = new MemoryFileSystem();
    const nativeExec = vi.fn();
    const select = Object.assign(function (this: unknown) { expect(Object.is(this, projection)).toBe(true); return "/"; }, { delegate: memory, nativeExec });
    const projection = Object.freeze({ select, delegate: memory, nativeExec, get unknown() { throw new Error("unknown field lookup"); } });
    Object.defineProperty(memory, pathNamespace, { value: projection });
    const readonly = new ReadOnlyFileSystem(memory);
    const exposed = Reflect.get(readonly, pathNamespace);
    expect(Object.is(exposed, projection)).toBe(false);
    expect(Reflect.ownKeys(exposed)).toEqual(["select"]);
    expect(Object.isFrozen(exposed)).toBe(true);
    expect(exposed.delegate).toBeUndefined();
    expect(exposed.nativeExec).toBeUndefined();
    const callback = exposed.select;
    expect(callback).not.toBe(select);
    expect(callback.delegate).toBeUndefined();
    expect(callback.nativeExec).toBeUndefined();
    expect(Object.isFrozen(callback)).toBe(true);
    expect(callback("/file")).toBe("/");
    expect(nativeExec).not.toHaveBeenCalled();
  });

  it("keeps metadata and selector lookups lazy and captures the original receiver per resolution", () => {
    const memory = new MemoryFileSystem();
    let projections = 0;
    let selectors = 0;
    const select = vi.fn(function (this: unknown) { expect(this).toBe(projection); return "/mounted"; });
    const projection = Object.freeze({ get select() { selectors++; return select; } });
    Object.defineProperty(memory, pathNamespace, { get() { projections++; return projection; } });
    const readonly = new ReadOnlyFileSystem(memory);
    expect(projections).toBe(0);
    expect(selectors).toBe(0);
    const captured = capturePathNamespace(readonly, {})!;
    expect(captured("/mounted/file")).toBe("/mounted");
    expect(captured("/mounted/other")).toBe("/mounted");
    expect(projections).toBe(1);
    expect(selectors).toBe(1);
    expect(select).toHaveBeenCalledTimes(2);
  });

  for (const phase of ["projection", "selector", "callback"]) {
    it.each([false, 0, "", null])(`preserves cancellation %s during ${phase} without a late callback`, reason => {
      const memory = new MemoryFileSystem();
      const controller = new AbortController();
      const select = vi.fn(() => { if (phase === "callback") controller.abort(reason); return "/"; });
      const lookup = vi.fn(() => { if (phase === "selector") controller.abort(reason); return select; });
      const projection = Object.freeze({ get select() { return lookup(); } });
      Object.defineProperty(memory, pathNamespace, { get() { if (phase === "projection") controller.abort(reason); return projection; } });
      const readonly = new ReadOnlyFileSystem(memory);
      let failure: unknown;
      try { capturePathNamespace(readonly, { signal: controller.signal })!("/file"); }
      catch (error) { failure = error; }
      expect(failure).toBe(reason);
      expect(lookup).toHaveBeenCalledTimes(phase === "projection" ? 0 : 1);
      expect(select).toHaveBeenCalledTimes(phase === "callback" ? 1 : 0);
    });
  }

  it.each([null, {}, { select: () => "/" }, Object.freeze({}), Object.freeze({ select: 0 })])("does not launder invalid namespace metadata %s", projection => {
    const memory = new MemoryFileSystem();
    Object.defineProperty(memory, pathNamespace, { value: projection });
    expect(() => capturePathNamespace(new ReadOnlyFileSystem(memory), {})).toThrow(expect.objectContaining({ code: "EIO" }));
  });

  it("preserves cancellation when a selector getter also returns an invalid value", () => {
    const memory = new MemoryFileSystem();
    const controller = new AbortController();
    const projection = Object.freeze({ get select() { controller.abort(false); return 0; } });
    Object.defineProperty(memory, pathNamespace, { value: projection });
    let failure: unknown;
    try { capturePathNamespace(new ReadOnlyFileSystem(memory), { signal: controller.signal }); }
    catch (error) { failure = error; }
    expect(failure).toBe(false);
  });

  it("does not look up a selector after metadata integrity inspection cancels", () => {
    const memory = new MemoryFileSystem();
    const controller = new AbortController();
    const lookup = vi.fn(() => () => "/");
    const projection = new Proxy(Object.freeze({ get select() { return lookup(); } }), {
      isExtensible(target) { controller.abort(false); return Reflect.isExtensible(target); },
    });
    Object.defineProperty(memory, pathNamespace, { value: projection });
    let failure: unknown;
    try { capturePathNamespace(new ReadOnlyFileSystem(memory), { signal: controller.signal }); }
    catch (error) { failure = error; }
    expect(failure).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not expose an object returned by a custom selector through the readonly symbol", () => {
    const memory = new MemoryFileSystem();
    Object.defineProperty(memory, pathNamespace, { value: Object.freeze({ select: () => memory }) });
    const projection = Reflect.get(new ReadOnlyFileSystem(memory), pathNamespace);
    expect(() => projection.select("/file")).toThrow(expect.objectContaining({ code: "EIO" }));
    expect(() => capturePathNamespace(new ReadOnlyFileSystem(memory), {})!("/file")).toThrow(expect.objectContaining({ code: "EIO" }));
  });

  for (const route of ["direct", "readonly", "nested readonly"]) {
    it.each([false, true])(`${route} keeps nonfrozen integrity observation cancellation=%s ahead of EIO`, cancel => {
      const memory = new MemoryFileSystem();
      const controller = new AbortController();
      const select = vi.fn(() => "/");
      const lookup = vi.fn(() => select);
      const integrity = vi.fn((target: object) => {
        if (cancel) controller.abort(false);
        return Reflect.isExtensible(target);
      });
      const projection = new Proxy({ get select() { return lookup(); } }, { isExtensible: integrity });
      Object.defineProperty(memory, pathNamespace, { value: projection });
      const filesystem = route === "direct" ? memory : route === "readonly" ? new ReadOnlyFileSystem(memory)
        : new ReadOnlyFileSystem(new ReadOnlyFileSystem(memory));
      let failure: unknown;
      try { capturePathNamespace(filesystem, { signal: controller.signal }); }
      catch (error) { failure = error; }
      if (cancel) expect(failure).toBe(false);
      else expect(failure).toMatchObject({ code: "EIO" });
      expect(integrity).toHaveBeenCalledTimes(1);
      expect(lookup).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
    });
  }

  it("exposes no delegate through the owned selector's internal capture callback", () => {
    const memory = new MemoryFileSystem();
    const rawSelect = Object.assign(() => "/", { delegate: memory, nativeExec: vi.fn() });
    Object.defineProperty(memory, pathNamespace, { value: Object.freeze({ select: rawSelect, delegate: memory }) });
    const projection = Reflect.get(new ReadOnlyFileSystem(memory), pathNamespace);
    const capture = Reflect.get(projection.select, Symbol.for("@poe-code/safe-fs/capture-path-namespace/v1"));
    expect(Object.isFrozen(capture)).toBe(true);
    expect(capture.delegate).toBeUndefined();
    const selected = capture({});
    expect(selected).not.toBe(rawSelect);
    expect(selected.delegate).toBeUndefined();
    expect(selected.nativeExec).toBeUndefined();
    expect(selected("/file")).toBe("/");
  });

  it.each(["integrity", "selector", "callback"])("preserves %s cancellation through separately loaded namespace consumers", async phase => {
    const memory = new MemoryFileSystem();
    const controller = new AbortController();
    const select = vi.fn(function (this: unknown) {
      expect(Object.is(this, projection)).toBe(true);
      if (phase === "callback") controller.abort(false);
      return "/";
    });
    const lookup = vi.fn(() => { if (phase === "selector") controller.abort(false); return select; });
    const projection = new Proxy(Object.freeze({ get select() { return lookup(); } }), {
      isExtensible(target) { if (phase === "integrity") controller.abort(false); return Reflect.isExtensible(target); },
    });
    Object.defineProperty(memory, pathNamespace, { value: projection });
    const readonly = new ReadOnlyFileSystem(new ReadOnlyFileSystem(memory));
    vi.resetModules();
    const { capturePathNamespace: capture } = await import("../src/fs/path-namespace.js");
    let failure: unknown;
    try { capture(readonly, { signal: controller.signal })!("/file"); }
    catch (error) { failure = error; }
    expect(failure).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(phase === "integrity" ? 0 : 1);
    expect(select).toHaveBeenCalledTimes(phase === "callback" ? 1 : 0);
  });

  it.each(["lookup", "capture"])("checks cancellation around internal capture %s before dispatch", phase => {
    const memory = new MemoryFileSystem();
    const controller = new AbortController();
    const selected = vi.fn(() => "/");
    const capture = vi.fn(() => { if (phase === "capture") controller.abort(false); return selected; });
    const select = vi.fn(() => "/");
    Object.defineProperty(select, Symbol.for("@poe-code/safe-fs/capture-path-namespace/v1"), {
      get() { if (phase === "lookup") controller.abort(false); return capture; },
    });
    Object.defineProperty(memory, pathNamespace, { value: Object.freeze({ select }) });
    let failure: unknown;
    try { capturePathNamespace(new ReadOnlyFileSystem(memory), { signal: controller.signal })!("/file"); }
    catch (error) { failure = error; }
    expect(failure).toBe(false);
    expect(capture).toHaveBeenCalledTimes(phase === "capture" ? 1 : 0);
    expect(select).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
  });

  it.each([null, 0, () => null, () => ({ delegate: "not a selector" })])("rejects malformed internal capture %s without falling back", capture => {
    const memory = new MemoryFileSystem();
    const select = vi.fn(() => "/");
    Object.defineProperty(select, Symbol.for("@poe-code/safe-fs/capture-path-namespace/v1"), { value: capture });
    Object.defineProperty(memory, pathNamespace, { value: Object.freeze({ select }) });
    expect(() => capturePathNamespace(new ReadOnlyFileSystem(memory), {})).toThrow(expect.objectContaining({ code: "EIO" }));
    expect(select).not.toHaveBeenCalled();
  });
});

describe("Device namespace projection admission", () => {
  it.each([false, 0, "", null])("preserves falsey cancellation %s across projection lookup and callback", async reason => {
    for (const phase of ["projection", "selector", "callback"]) {
      const memory = new MemoryFileSystem();
      await memory.writeFile("/file", Uint8Array.of(1));
      await memory.symlink("file", "/alias");
      const controller = new AbortController();
      const selector = vi.fn(() => { if (phase === "callback") controller.abort(reason); return "/"; });
      const projection = Object.freeze({ get select() { if (phase === "selector") controller.abort(reason); return selector; } });
      Object.defineProperty(memory, pathNamespace, { get() { if (phase === "projection") controller.abort(reason); return projection; } });
      const lstat = vi.fn(memory.lstat.bind(memory));
      const query = vi.fn(async () => memory.capabilities);
      const open = vi.fn(memory.openResizeFile.bind(memory));
      const devices = new DeviceFileSystem(view(memory, { lstat, capabilitiesFor: query, openResizeFile: open }));
      await expect(devices.capabilitiesFor("/alias", { create: false, signal: controller.signal })).rejects.toBe(reason);
      expect(selector).toHaveBeenCalledTimes(phase === "callback" ? 1 : 0);
      expect(lstat).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    }
  });

  it("captures the selector once per resolution with its metadata receiver", async () => {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/directory");
    await memory.writeFile("/file", Uint8Array.of(1));
    await memory.symlink("../file", "/directory/alias");
    let reads = 0;
    const poison = vi.fn(() => { throw new Error("second selector lookup"); });
    const selector = vi.fn(function (this: unknown) { expect(this).toBe(projection); return "/"; });
    const projection = Object.freeze({ get select() { return ++reads === 1 ? selector : poison; } });
    Object.defineProperty(memory, pathNamespace, { value: projection });
    const devices = new DeviceFileSystem(memory);
    expect((await devices.capabilitiesFor("/directory/alias")).retainedResize).toBe(true);
    expect(reads).toBe(1);
    expect(selector.mock.calls.length).toBeGreaterThan(1);
    expect(poison).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 42, "relative", "/elsewhere", "/directory/..", "/directory/", "/\0", Promise.resolve("/")])("fails closed on invalid selected root %s", async selected => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", Uint8Array.of(1));
    Object.defineProperty(memory, pathNamespace, { value: Object.freeze({ select: () => selected }) });
    const open = vi.fn(memory.openResizeFile.bind(memory));
    const devices = new DeviceFileSystem(view(memory, { openResizeFile: open }));
    await expect(devices.openResizeFile("/file")).rejects.toMatchObject({ code: "EIO" });
    expect(open).not.toHaveBeenCalled();
    expect(await memory.readFile("/file")).toEqual(Uint8Array.of(1));
  });

  it.each([null, {}, { select: () => "/" }, Object.freeze({}), Object.freeze({ select: 0 })])("refuses malformed or unfrozen projection %s", async projection => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", Uint8Array.of(1));
    Object.defineProperty(memory, pathNamespace, { value: projection });
    const open = vi.fn(memory.openResizeFile.bind(memory));
    const devices = new DeviceFileSystem(view(memory, { openResizeFile: open }));
    await expect(devices.openResizeFile("/file")).rejects.toMatchObject({ code: "EIO" });
    expect(open).not.toHaveBeenCalled();
  });

  it("preserves a falsey selector failure without turning it into a namespace root", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", Uint8Array.of(1));
    Object.defineProperty(memory, pathNamespace, { value: Object.freeze({ select() { throw false; } }) });
    await expect(new DeviceFileSystem(memory).openResizeFile("/file")).rejects.toBe(false);
  });
});

function view(backing: FileSystem, overrides: { [Key in keyof FileSystem]?: FileSystem[Key] | undefined }): FileSystem {
  return new Proxy(backing, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function fixture() {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/file", Uint8Array.of(1, 2, 3));
  let stat: FileStat = { ...await memory.stat("/file"), preferredIoBlockSize: 8192 };
  let closing: Promise<void> | undefined;
  const check = () => { if (closing) throw new FsError("EBADF"); };
  const handle: FileResizeHandle = {
    stat: vi.fn(async () => { check(); return { ...stat }; }),
    truncate: vi.fn(async length => { check(); stat = { ...stat, size: length }; }),
    close: vi.fn(() => closing ??= Promise.resolve()),
  };
  const open = vi.fn(async () => handle);
  const backing = view(memory, { capabilities: { ...memory.capabilities, retainedResize: true }, capabilitiesFor: undefined, openResizeFile: open });
  return { memory, backing, handle, open };
}

const wrappers: readonly [string, (backing: FileSystem, signal?: AbortSignal) => FileSystem][] = [
  ["mount", backing => new MountFileSystem({ root: backing })],
  ["devices", backing => new DeviceFileSystem(backing)],
  ["scoped", (backing, signal = new AbortController().signal) => scopeFileSystem(backing, () => {}, signal)],
];

describe.each(wrappers)("%s retained-resize composition", (_name, wrap) => {
  it("routes one writable acquisition with options and retains its object", async () => {
    const { backing, memory, open, handle } = await fixture();
    const filesystem = wrap(backing);
    expect((await filesystem.capabilitiesFor?.("/file") ?? filesystem.capabilities).retainedResize).toBe(true);
    const signal = new AbortController().signal;
    const retained = await filesystem.openResizeFile!("/file", { create: true, mode: 0o600, signal });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("/file", expect.objectContaining({ create: true, mode: 0o600 }));
    await memory.rename("/file", "/moved");
    await memory.writeFile("/file", Uint8Array.of(9));
    await retained.truncate(7);
    expect(await retained.stat()).toMatchObject({ size: 7, preferredIoBlockSize: 8192 });
    expect(await memory.readFile("/file")).toEqual(Uint8Array.of(9));
    expect(handle.truncate).toHaveBeenCalledTimes(1);
    const closing = retained.close();
    expect(retained.close()).toBe(closing);
    await closing;
    await expect(retained.truncate(1)).rejects.toMatchObject({ code: "EBADF" });
  });

  it.each([false, undefined])("does not acquire when selected support is %s", async retainedResize => {
    const { backing, open } = await fixture();
    const capabilities = { ...backing.capabilities };
    Reflect.set(capabilities, "retainedResize", retainedResize);
    const filesystem = wrap(view(backing, { capabilities }));
    expect((await filesystem.capabilitiesFor?.("/file") ?? filesystem.capabilities).retainedResize).not.toBe(true);
    await expect(filesystem.openResizeFile!("/file")).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(open).not.toHaveBeenCalled();
  });

  it("denies a readonly selected backend without acquiring", async () => {
    const { backing, open } = await fixture();
    const filesystem = wrap(view(backing, { capabilities: { ...backing.capabilities, readOnly: true } }));
    expect((await filesystem.capabilitiesFor?.("/file") ?? filesystem.capabilities).retainedResize).toBe(false);
    await expect(filesystem.openResizeFile!("/file")).rejects.toMatchObject({ code: "EROFS" });
    expect(open).not.toHaveBeenCalled();
  });

  it("does not advertise a missing acquisition method", async () => {
    const { backing } = await fixture();
    const filesystem = wrap(view(backing, { openResizeFile: undefined }));
    expect(filesystem.capabilities.retainedResize).not.toBe(true);
    expect((await filesystem.capabilitiesFor?.("/file") ?? filesystem.capabilities).retainedResize).not.toBe(true);
  });

  it.each([false, 0, "", null, undefined, NaN])("closes late acquisition before settling cancellation %s", async reason => {
    const { backing } = await fixture();
    const entered = deferred<void>(), acquired = deferred<FileResizeHandle>(), retired = deferred<void>(), released = deferred<void>();
    const close = vi.fn(async () => { retired.resolve(); await released.promise; throw new Error("secondary close"); });
    const open = vi.fn(() => { entered.resolve(); return acquired.promise; });
    const controller = new AbortController();
    const filesystem = wrap(view(backing, { openResizeFile: open }));
    let settled = false;
    const result = filesystem.openResizeFile!("/file", { signal: controller.signal }).then(
      value => { settled = true; return { value, error: Symbol("success") }; },
      error => { settled = true; return { error }; },
    );
    await entered.promise;
    controller.abort(reason);
    acquired.resolve({ stat: vi.fn(), truncate: vi.fn(), close });
    await retired.promise;
    expect(settled).toBe(false);
    released.resolve();
    expect(Object.is((await result).error, controller.signal.reason)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("interrupts opaque capabilities without a later open", async () => {
    const { backing, open } = await fixture();
    const entered = deferred<void>(), metadata = deferred<FileSystemCapabilities>();
    const controller = new AbortController();
    const filesystem = wrap(view(backing, { capabilitiesFor: () => { entered.resolve(); return metadata.promise; } }));
    let settled = false;
    const pending = filesystem.openResizeFile!("/file", { signal: controller.signal }).catch(error => { settled = true; return error; });
    await entered.promise;
    controller.abort(false);
    await new Promise<void>(resolve => setImmediate(resolve));
    try { expect(settled).toBe(true); }
    finally { metadata.resolve({ retainedResize: true }); }
    expect(await pending).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it.each([false, 0, "", null, undefined, NaN])("preserves acquisition failure %s", async reason => {
    const { backing } = await fixture();
    const filesystem = wrap(view(backing, { openResizeFile: async () => { throw reason; } }));
    const outcome = await filesystem.openResizeFile!("/file").then(() => ({ rejected: false, error: null }), error => ({ rejected: true, error }));
    expect(outcome.rejected).toBe(true);
    expect(Object.is(outcome.error, reason)).toBe(true);
  });

  it.each([false, 0, "", null, undefined, NaN])("preserves shared close failure %s", async reason => {
    const { backing, handle } = await fixture();
    const finish = handle.close;
    let closing: Promise<void> | undefined;
    handle.close = () => closing ??= finish().then(() => { throw reason; });
    const retained = await wrap(backing).openResizeFile!("/file");
    const pending = retained.close();
    expect(retained.close()).toBe(pending);
    const outcome = await pending.then(() => ({ rejected: false, error: null }), error => ({ rejected: true, error }));
    expect(outcome.rejected).toBe(true);
    expect(Object.is(outcome.error, reason)).toBe(true);
    expect(finish).toHaveBeenCalledTimes(1);
    await expect(retained.stat()).rejects.toMatchObject({ code: "EBADF" });
  });

  it("uses selected-path support instead of a positive global declaration", async () => {
    const { backing, open } = await fixture();
    const filesystem = wrap(view(backing, { capabilitiesFor: async () => ({ ...backing.capabilities, retainedResize: false }) }));
    await expect(filesystem.openResizeFile!("/file")).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["Memory", "Real"])("retains %s identity and write authority through namespace changes", async adapter => {
    vol.reset();
    vol.mkdirSync("/machine");
    const backing: FileSystem = adapter === "Memory" ? new MemoryFileSystem() : new RealFileSystem("/machine");
    await backing.writeFile("/file", Uint8Array.of(1, 2, 3));
    await backing.link!("/file", "/alias");
    const filesystem = wrap(backing);
    const retained = await filesystem.openResizeFile!("/file");
    try {
      const before = await retained.stat();
      expect(before.preferredIoBlockSize).toBeGreaterThan(0);
      await backing.rename("/file", "/old");
      await backing.writeFile("/file", Uint8Array.of(9));
      await retained.truncate(5);
      expect(await backing.readFile("/alias")).toEqual(Uint8Array.of(1, 2, 3, 0, 0));
      await backing.chmod!("/alias", 0);
      await retained.truncate(2);
      expect(await retained.stat()).toMatchObject({ size: 2, ino: before.ino, preferredIoBlockSize: before.preferredIoBlockSize });
      await backing.rm("/old");
      await backing.rm("/alias");
      await retained.truncate(4);
      expect((await retained.stat()).size).toBe(4);
      expect(await backing.readFile("/file")).toEqual(Uint8Array.of(9));
    } finally { await retained.close(); }
  });
});

it.each(wrappers.slice(0, 2))("%s interrupts opaque path resolution without a late open", async (_name, wrap) => {
  const { backing, open, handle } = await fixture();
  const entered = deferred<void>(), metadata = deferred<FileStat>();
  const controller = new AbortController();
  const filesystem = wrap(view(backing, { lstat: () => { entered.resolve(); return metadata.promise; } }));
  let settled = false;
  const pending = filesystem.openResizeFile!("/file", { signal: controller.signal }).catch(error => { settled = true; return error; });
  await entered.promise;
  controller.abort(false);
  await new Promise<void>(resolve => setImmediate(resolve));
  try { expect(settled).toBe(true); }
  finally { metadata.resolve(await handle.stat()); }
  expect(await pending).toBe(false);
  expect(open).not.toHaveBeenCalled();
  await handle.close();
});

it("routes mount creation and selected support without leaking unsupported roots", async () => {
  const { backing, open, handle } = await fixture();
  const root = new MemoryFileSystem();
  const filesystem = new MountFileSystem({ root: view(root, { capabilities: { ...root.capabilities, retainedResize: false } }), mounts: { "/selected": backing } });
  expect(filesystem.capabilities.retainedResize).not.toBe(true);
  expect((await filesystem.capabilitiesFor("/selected/new")).retainedResize).toBe(true);
  const retained = await filesystem.openResizeFile!("/selected/new", { create: true, mode: 0o620 });
  expect(retained).toBe(handle);
  expect(open).toHaveBeenCalledWith("/new", expect.objectContaining({ create: true, mode: 0o620 }));
  await retained.close();
});

it("opens the pinned null target and reports EINVAL at ftruncate, not acquisition", async () => {
  const { backing, open } = await fixture();
  const filesystem = new DeviceFileSystem(backing);
  expect(filesystem.capabilities.retainedResize).toBe(true);
  expect((await filesystem.capabilitiesFor("/dev/null")).retainedResize).toBe(true);
  const retained = await filesystem.openResizeFile("/dev/null", { create: true, mode: 0o600 });
  try {
    expect(await retained.stat()).toMatchObject({ type: "character", size: 0, mode: 0o020666, preferredIoBlockSize: 4096 });
    for (const length of [0, 1, 4096, Number.MAX_SAFE_INTEGER]) {
      await expect(retained.truncate(length)).rejects.toMatchObject({ code: "EINVAL", syscall: "ftruncate", path: "/dev/null" });
      expect((await retained.stat()).size).toBe(0);
    }
  } finally { await retained.close(); }
  expect((await filesystem.capabilitiesFor("/dev")).retainedResize).toBe(false);
  await expect(filesystem.openResizeFile("/dev")).rejects.toMatchObject({ code: "EISDIR", syscall: "openResizeFile" });
  expect(open).not.toHaveBeenCalled();
});

describe("virtual null seekEnd", () => {
  for (const method of ["openReadFile", "openResizeFile"] as const) {
    it(`${method} reports the genuine virtual end without changing character semantics`, async () => {
      const filesystem = new DeviceFileSystem(new MemoryFileSystem());
      const retained = await filesystem[method]("/dev/null");
      try {
        expect(retained.seekEnd).toBeTypeOf("function");
        expect(await retained.seekEnd!()).toBe(0n);
        expect(await retained.seekEnd!()).toBe(0n);
        expect(await retained.stat()).toMatchObject({ type: "character", size: 0, preferredIoBlockSize: 4096 });
        if ("truncate" in retained) {
          for (const length of [0, 1]) await expect(retained.truncate(length)).rejects.toMatchObject({ code: "EINVAL", syscall: "ftruncate" });
        } else expect(await retained.read(0, 1)).toEqual(new Uint8Array());
      } finally { await retained.close(); }
    });

    it(`${method} stops saved and newly looked-up seek methods at close admission`, async () => {
      const retained = await new DeviceFileSystem(new MemoryFileSystem())[method]("/dev/null");
      try {
        expect(retained.seekEnd).toBeTypeOf("function");
        const seek = retained.seekEnd!;
        const admitted = seek();
        const closing = retained.close();
        await expect(seek()).rejects.toMatchObject({ code: "EBADF" });
        await expect(retained.seekEnd!()).rejects.toMatchObject({ code: "EBADF" });
        expect(await admitted).toBe(0n);
        await closing;
      } finally { await retained.close(); }
    });

    it.each([false, 0, "", null, undefined, NaN])(`${method} preserves cancellation %s before closed admission`, async reason => {
      const filesystem = new DeviceFileSystem(new MemoryFileSystem());
      const retained = await filesystem[method]("/dev/null");
      const controller = new AbortController();
      controller.abort(reason);
      try {
        expect(retained.seekEnd).toBeTypeOf("function");
        const seek = retained.seekEnd!;
        await expect(filesystem[method]("/dev/null", { signal: controller.signal })).rejects.toBe(controller.signal.reason);
        for (const closed of [false, true]) {
          if (closed) await retained.close();
          await expect(seek({ signal: controller.signal })).rejects.toBe(controller.signal.reason);
        }
      } finally { await retained.close(); }
    });

    it.each(["direct", "mount", "scoped mount", "nested device"])(`${method} forwards selected null aliases through %s without backing writes`, async route => {
      const memory = new MemoryFileSystem();
      await memory.mkdir("/dev");
      await memory.writeFile("/dev/null", Uint8Array.of(7, 8));
      await memory.symlink("/dev/null", "/alias");
      const device = new DeviceFileSystem(memory);
      const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/selected": device } });
      const filesystem = route === "direct" ? device : route === "mount" ? mount
        : route === "scoped mount" ? scopeFileSystem(mount, () => {}, new AbortController().signal)
        : new DeviceFileSystem(mount);
      const retained = await filesystem[method]!(route === "direct" ? "/alias" : "/selected/alias");
      try {
        expect(retained.seekEnd).toBeTypeOf("function");
        expect(await retained.seekEnd!()).toBe(0n);
        expect(await retained.stat()).toMatchObject({ type: "character", size: 0 });
      } finally { await retained.close(); }
      expect(await memory.readFile("/dev/null")).toEqual(Uint8Array.of(7, 8));
      expect(await memory.readlink("/alias")).toBe("/dev/null");
    });

    it(`${method} rejects saved scoped seek after lifetime cancellation and permits cleanup`, async () => {
      const controller = new AbortController();
      const filesystem = scopeFileSystem(new DeviceFileSystem(new MemoryFileSystem()), () => {}, controller.signal);
      const retained = await filesystem[method]!("/dev/null");
      try {
        expect(retained.seekEnd).toBeTypeOf("function");
        const seek = retained.seekEnd!;
        expect(await seek()).toBe(0n);
        controller.abort(false);
        await expect(seek()).rejects.toBe(false);
        await retained.close();
        await expect(seek()).rejects.toBe(false);
      } finally { await retained.close(); }
    });
  }

  it("forwards readonly null reads without weakening readonly resize policy", async () => {
    const filesystem = new ReadOnlyFileSystem(new DeviceFileSystem(new MemoryFileSystem()));
    const reader = await filesystem.openReadFile("/dev/null");
    try {
      expect(reader.seekEnd).toBeTypeOf("function");
      expect(await reader.seekEnd!()).toBe(0n);
      await expect(filesystem.openResizeFile("/dev/null")).rejects.toMatchObject({ code: "EROFS" });
    } finally { await reader.close(); }
  });
});

it("keeps the null metadata policy consistent without inventing directory metadata", async () => {
  const { backing } = await fixture();
  const filesystem = new DeviceFileSystem(backing);
  const retained = await filesystem.openResizeFile("/dev/null");
  const reader = await filesystem.openReadFile("/dev/null");
  try {
    const expected = await retained.stat();
    expect(expected.preferredIoBlockSize).toBe(4096);
    expect(await reader.stat()).toEqual(expected);
    expect(await filesystem.stat("/dev/null")).toEqual(expected);
    expect(await filesystem.lstat("/dev/null")).toEqual(expected);
    const snapshot = await retained.stat();
    Reflect.set(snapshot, "size", 20);
    expect((await retained.stat()).size).toBe(0);
    expect(await filesystem.stat("/dev")).not.toHaveProperty("preferredIoBlockSize");
  } finally { await Promise.all([retained.close(), reader.close()]); }
});

it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("null resize validates length %s and closes admission synchronously", async length => {
  const { backing } = await fixture();
  const filesystem = new DeviceFileSystem(backing);
  const retained = await filesystem.openResizeFile("/dev/null");
  await expect(retained.truncate(length)).rejects.toMatchObject({ code: "EINVAL", syscall: "ftruncate" });
  const closing = retained.close();
  expect(retained.close()).toBe(closing);
  await expect(retained.stat()).rejects.toMatchObject({ code: "EBADF", syscall: "fstat" });
  await expect(retained.truncate(length)).rejects.toMatchObject({ code: "EBADF", syscall: "ftruncate" });
  await closing;
});

it.each([false, 0, "", null, undefined, NaN])("null cancellation %s precedes closed and invalid-length errors", async reason => {
  const { backing, open } = await fixture();
  const filesystem = new DeviceFileSystem(backing);
  const controller = new AbortController();
  controller.abort(reason);
  for (const path of ["/dev/null", "/dev"]) {
    const outcome = await filesystem.openResizeFile(path, { signal: controller.signal }).catch(error => error);
    expect(Object.is(outcome, controller.signal.reason)).toBe(true);
  }
  const retained = await filesystem.openResizeFile("/dev/null");
  for (const closed of [false, true]) {
    if (closed) await retained.close();
    const statFailure = await retained.stat({ signal: controller.signal }).catch(error => error);
    const resizeFailure = await retained.truncate(-1, { signal: controller.signal }).catch(error => error);
    expect(Object.is(statFailure, controller.signal.reason)).toBe(true);
    expect(Object.is(resizeFailure, controller.signal.reason)).toBe(true);
  }
  expect(retained.close()).toBe(retained.close());
  expect(open).not.toHaveBeenCalled();
});

it("keeps readonly authority local to the selected null composition", async () => {
  const { backing, open } = await fixture();
  const readonly = new ReadOnlyFileSystem(new DeviceFileSystem(backing));
  await expect(readonly.openResizeFile("/dev/null")).rejects.toMatchObject({ code: "EROFS", syscall: "openResizeFile" });
  const writableDevice = new DeviceFileSystem(new ReadOnlyFileSystem(backing));
  await expect(writableDevice.openResizeFile("/file")).rejects.toMatchObject({ code: "EROFS" });
  const retained = await writableDevice.openResizeFile("/dev/null");
  try { await expect(retained.truncate(0)).rejects.toMatchObject({ code: "EINVAL", syscall: "ftruncate" }); }
  finally { await retained.close(); }
  const contradictory = new DeviceFileSystem(view(backing, { capabilities: { ...backing.capabilities, readOnly: true } }));
  expect(contradictory.capabilities.retainedResize).not.toBe(true);
  expect((await contradictory.capabilitiesFor("/file")).retainedResize).toBe(false);
  expect((await contradictory.capabilitiesFor("/dev/null")).retainedResize).toBe(true);
  expect(open).not.toHaveBeenCalled();
});

it.each(["/dev/./null", "/dev/../dev/null", "/alias"])("pins null through %s without opening or modifying a backing file", async path => {
  const { backing, memory, open } = await fixture();
  await memory.mkdir("/dev");
  await memory.writeFile("/dev/null", Uint8Array.of(5));
  await memory.symlink("/dev/null", "/alias");
  const filesystem = new DeviceFileSystem(backing);
  expect((await filesystem.capabilitiesFor(path)).retainedResize).toBe(true);
  const retained = await filesystem.openResizeFile(path);
  try {
    const stat = await retained.stat();
    await memory.rm("/alias");
    await memory.writeFile("/alias", Uint8Array.of(7));
    await expect(retained.truncate(4096)).rejects.toMatchObject({ code: "EINVAL", syscall: "ftruncate", path });
    expect(await retained.stat()).toEqual(stat);
    expect(await memory.readFile("/dev/null")).toEqual(Uint8Array.of(5));
    expect(await memory.readFile("/alias")).toEqual(Uint8Array.of(7));
    await expect(filesystem.openResizeFile("/dev/null/")).rejects.toMatchObject({ code: "ENOTDIR" });
  } finally { await retained.close(); }
  expect(open).not.toHaveBeenCalled();
});

it.each(["mount", "scoped"])("%s admits the null retained protocol without promising successful resize", async composition => {
  const { backing, open } = await fixture();
  const device = new DeviceFileSystem(backing);
  let charges = 0;
  const filesystem = composition === "mount" ? new MountFileSystem({ root: device })
    : scopeFileSystem(device, () => { charges++; }, new AbortController().signal);
  const retained = await filesystem.openResizeFile!("/dev/null");
  expect((await retained.stat()).preferredIoBlockSize).toBe(4096);
  await expect(retained.truncate(4096)).rejects.toMatchObject({ code: "EINVAL", syscall: "ftruncate" });
  const closing = retained.close();
  expect(retained.close()).toBe(closing);
  await closing;
  expect(charges).toBe(composition === "scoped" ? 3 : 0);
  expect(open).not.toHaveBeenCalled();
});

it("readonly rejects resize before opaque backing metadata or acquisition", async () => {
  const { backing, open } = await fixture();
  const metadata = vi.fn(() => new Promise<FileSystemCapabilities>(() => {}));
  const filesystem = new ReadOnlyFileSystem(view(backing, { capabilitiesFor: metadata }));
  expect(filesystem.capabilities.retainedResize).toBe(false);
  await expect(filesystem.openResizeFile!("/file", { create: true })).rejects.toMatchObject({ code: "EROFS" });
  expect(metadata).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it("overlay denies retained resize on both layers without forwarding raw handles", async () => {
  const upper = await fixture(), lower = await fixture();
  const filesystem = new OverlayFileSystem({ upper: upper.backing, lower: lower.backing });
  expect(filesystem.capabilities.retainedResize).toBe(false);
  expect((await filesystem.capabilitiesFor("/file")).retainedResize).toBe(false);
  expect((filesystem as FileSystem).openResizeFile).toBeUndefined();
  expect(upper.open).not.toHaveBeenCalled();
  expect(lower.open).not.toHaveBeenCalled();
});

it("scoped open/stat/resize are metered but close survives exhausted admission", async () => {
  const { backing, handle } = await fixture();
  const exhausted = new Error("operation budget");
  let charges = 0;
  const filesystem = scopeFileSystem(backing, () => { if (++charges > 3) throw exhausted; }, new AbortController().signal);
  const retained = await filesystem.openResizeFile!("/file");
  await retained.stat();
  await retained.truncate(4);
  await expect(retained.truncate(8)).rejects.toBe(exhausted);
  expect(handle.truncate).toHaveBeenCalledTimes(1);
  const closing = retained.close();
  expect(retained.close()).toBe(closing);
  await closing;
  expect(handle.close).toHaveBeenCalledTimes(1);
  expect(charges).toBe(4);
  await expect(retained.stat()).rejects.toMatchObject({ code: "EBADF" });
  expect(charges).toBe(4);
});

it("scoped cancellation during acquisition retires late handles without per-call signal", async () => {
  const { backing, handle } = await fixture();
  const entered = deferred<void>(), acquired = deferred<FileResizeHandle>();
  const controller = new AbortController();
  const filesystem = scopeFileSystem(view(backing, { openResizeFile: () => { entered.resolve(); return acquired.promise; } }), () => {}, controller.signal);
  const pending = filesystem.openResizeFile!("/file").catch(error => error);
  await entered.promise;
  controller.abort(0);
  acquired.resolve(handle);
  expect(await pending).toBe(0);
  expect(handle.close).toHaveBeenCalledTimes(1);
});

it("reentrant scoped metering cannot admit resize after cancellation", async () => {
  const { backing, handle } = await fixture();
  const controller = new AbortController();
  let charges = 0;
  const filesystem = scopeFileSystem(backing, () => { if (++charges === 2) controller.abort(false); }, controller.signal);
  const retained = await filesystem.openResizeFile!("/file");
  await expect(retained.truncate(8)).rejects.toBe(false);
  expect(handle.truncate).not.toHaveBeenCalled();
  await retained.close();
});

it("reentrant scoped metering cannot admit resize after close", async () => {
  const { backing, handle } = await fixture();
  let charges = 0;
  const filesystem = scopeFileSystem(backing, () => { if (++charges === 2) void retained.close(); }, new AbortController().signal);
  const retained = await filesystem.openResizeFile!("/file");
  await expect(retained.truncate(8)).rejects.toMatchObject({ code: "EBADF" });
  expect(handle.truncate).not.toHaveBeenCalled();
  await retained.close();
  expect(handle.close).toHaveBeenCalledTimes(1);
});

it("scoped close preserves an admitted mutation drain without charging cleanup", async () => {
  const { backing, handle } = await fixture();
  const entered = deferred<void>(), released = deferred<void>();
  const finish = handle.close;
  let active: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  handle.truncate = async () => {
    if (closing) throw new FsError("EBADF");
    active = released.promise;
    entered.resolve();
    await active;
  };
  handle.close = () => closing ??= Promise.resolve().then(async () => { await active; await finish(); });
  let charges = 0;
  const retained = await scopeFileSystem(backing, () => { charges++; }, new AbortController().signal).openResizeFile!("/file");
  const mutation = retained.truncate(8);
  await entered.promise;
  let settled = false;
  const drain = retained.close();
  void drain.then(() => { settled = true; });
  expect(retained.close()).toBe(drain);
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(charges).toBe(2);
  await expect(retained.truncate(9)).rejects.toMatchObject({ code: "EBADF" });
  released.resolve();
  await mutation;
  await drain;
  expect(finish).toHaveBeenCalledTimes(1);
  expect(charges).toBe(2);
});

it.each(["stat", "truncate"] as const)("scoped %s cannot report success after scope cancellation", async operation => {
  const { backing, handle } = await fixture();
  const completed = deferred<FileStat>(), entered = deferred<void>();
  const controller = new AbortController();
  const held: FileResizeHandle = {
    ...handle,
    stat: async () => { entered.resolve(); return completed.promise; },
    truncate: async () => { entered.resolve(); await completed.promise; },
  };
  const filesystem = scopeFileSystem(view(backing, { openResizeFile: async () => held }), () => {}, controller.signal);
  const retained = await filesystem.openResizeFile!("/file");
  const pending = (operation === "stat" ? retained.stat() : retained.truncate(4)).then(() => ({ error: Symbol("success") }), error => ({ error }));
  await entered.promise;
  controller.abort(false);
  completed.resolve(await handle.stat());
  expect((await pending).error).toBe(false);
  await retained.close();
});

describe.each(["mount", "readonly", "overlay", "devices"])("%s preferred I/O metadata", name => {
  it.each([8192, undefined])("preserves observed %s without inventing a hint", async preferredIoBlockSize => {
    const { memory, backing } = await fixture();
    const observe = async (path: string) => {
      const { preferredIoBlockSize: ignored, ...stat } = await memory.stat(path);
      return { ...stat, ...(preferredIoBlockSize === undefined ? {} : { preferredIoBlockSize }) };
    };
    const host = view(backing, { stat: observe, lstat: observe });
    const filesystem = name === "mount" ? new MountFileSystem({ root: host })
      : name === "readonly" ? new ReadOnlyFileSystem(host)
        : name === "overlay" ? new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: host })
          : new DeviceFileSystem(host);
    expect((await filesystem.stat("/file")).preferredIoBlockSize).toBe(preferredIoBlockSize);
    expect((await filesystem.lstat("/file")).preferredIoBlockSize).toBe(preferredIoBlockSize);
  });
});

it("bridge uses an observed hint and preserves its existing unknown fallback", async () => {
  const { handle } = await fixture();
  const stat = await handle.stat();
  expect(bridgeStats(stat).blksize).toBe(8192);
  const { preferredIoBlockSize: ignored, ...unknown } = stat;
  expect(bridgeStats(unknown).blksize).toBe(4096);
  expect(unknown).not.toHaveProperty("preferredIoBlockSize");
  await handle.close();
});

it("remote replacement backends and composed routes never advertise retained resize", async () => {
  const remote: FileSystem[] = [
    new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" }),
    new WebDavFileSystem({ fetch: new MockDav().createFetch(), baseUrl: "https://example.invalid/dav/" }),
  ];
  for (const backing of remote) {
    expect(backing.capabilities.retainedResize).not.toBe(true);
    for (const [, wrap] of wrappers) {
      const filesystem = wrap(backing);
      expect(filesystem.capabilities.retainedResize).not.toBe(true);
      expect((await filesystem.capabilitiesFor?.("/file") ?? filesystem.capabilities).retainedResize).not.toBe(true);
    }
  }
});

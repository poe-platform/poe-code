import { describe, expect, it, vi } from "vitest";
import type { FileResizeHandle, FileStat, FileSystem, FileSystemCapabilities } from "../src/contracts/filesystem.js";
import * as admission from "../src/fs/capabilities.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(capabilities: FileSystemCapabilities = { retainedResize: true }) {
  const stat: FileStat = { type: "file", size: 3, mode: 0o600, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 };
  const handle: FileResizeHandle = { stat: vi.fn(async () => stat), truncate: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  const openResizeFile = vi.fn(async () => handle);
  const filesystem = { capabilities, openResizeFile } as unknown as FileSystem;
  return { filesystem, handle, openResizeFile };
}

describe("retained-resize admission", () => {
  it("explicitly denies retained mutation in readonly capability views", () => {
    expect(admission.readOnlyCapabilities({ retainedResize: true }).retainedResize).toBe(false);
  });

  it("does not infer support from a flag without a method", () => {
    const filesystem = { capabilities: { retainedResize: true } } as FileSystem;
    expect(admission.retainedResizeCapabilities(filesystem).retainedResize).toBe(false);
  });

  it.each([{}, { retainedResize: false }, { readOnly: true }])("preserves unpromised capability identity %j", capabilities => {
    const original = Object.freeze({ read: true, ...capabilities });
    const filesystem = Object.freeze({ capabilities: original }) as unknown as FileSystem;
    expect(admission.retainedResizeCapabilities(filesystem)).toBe(original);
    expect(admission.retainedResizeCapabilities(filesystem).retainedResize).not.toBe(true);
  });

  it("revokes an affirmative readonly promise without mutating its capability object", () => {
    const capabilities = Object.freeze({ readOnly: true, retainedResize: true });
    const { filesystem, openResizeFile } = fixture(capabilities);
    const actual = admission.retainedResizeCapabilities(filesystem);
    expect(actual).toEqual({ readOnly: true, retainedResize: false });
    expect(actual).not.toBe(capabilities);
    expect(capabilities.retainedResize).toBe(true);
    expect(openResizeFile).not.toHaveBeenCalled();
  });

  it("preserves the handle and acquisition options without reading or resizing", async () => {
    const { filesystem, handle, openResizeFile } = fixture();
    const options = { create: true, mode: 0o620, signal: new AbortController().signal };
    expect(await admission.openRetainedResizeFile(filesystem, "/file", options)).toBe(handle);
    expect(openResizeFile).toHaveBeenCalledExactlyOnceWith("/file", options);
    expect(handle.stat).not.toHaveBeenCalled();
    expect(handle.truncate).not.toHaveBeenCalled();
    expect(handle.close).not.toHaveBeenCalled();
  });

  it.each([undefined, false, true])("queries writable-open intent with create %s", async create => {
    const { filesystem, handle } = fixture();
    const signal = new AbortController().signal;
    filesystem.capabilitiesFor = vi.fn(async () => filesystem.capabilities);
    await expect(admission.openRetainedResizeFile(filesystem, "/file", { signal, ...(create === undefined ? {} : { create }) })).resolves.toBe(handle);
    expect(filesystem.capabilitiesFor).toHaveBeenCalledExactlyOnceWith("/file", { signal, create: create === true });
    await handle.close();
  });

  it("does not query after reading creation intent cancels", async () => {
    const { filesystem, openResizeFile } = fixture();
    const controller = new AbortController();
    filesystem.capabilitiesFor = vi.fn(async () => filesystem.capabilities);
    const options = { signal: controller.signal, get create() { controller.abort(null); return true; } };
    await expect(admission.openRetainedResizeFile(filesystem, "/file", options)).rejects.toBe(null);
    expect(filesystem.capabilitiesFor).not.toHaveBeenCalled();
    expect(openResizeFile).not.toHaveBeenCalled();
  });

  it.each([false, undefined])("refuses unpromised support %s before acquisition", async retainedResize => {
    const capabilities: FileSystemCapabilities = {};
    Reflect.set(capabilities, "retainedResize", retainedResize);
    const { filesystem, openResizeFile } = fixture(capabilities);
    await expect(admission.openRetainedResizeFile(filesystem, "/file", {})).rejects.toMatchObject({ code: "ENOTSUP", path: "/file" });
    expect(openResizeFile).not.toHaveBeenCalled();
  });

  it("uses selected-path capability and refuses readonly before acquisition", async () => {
    const { filesystem, openResizeFile } = fixture();
    filesystem.capabilitiesFor = vi.fn(async () => ({ readOnly: true, retainedResize: true }));
    await expect(admission.openRetainedResizeFile(filesystem, "/file", {})).rejects.toMatchObject({ code: "EROFS" });
    expect(openResizeFile).not.toHaveBeenCalled();
  });

  it("admits selected-path support despite a negative global summary", async () => {
    const { filesystem, handle } = fixture({ retainedResize: false });
    filesystem.capabilitiesFor = vi.fn(async () => ({ retainedResize: true }));
    expect(await admission.openRetainedResizeFile(filesystem, "/file", {})).toBe(handle);
  });

  it.each([false, null, 0, ""])("does no work after caller cancellation %j", async reason => {
    const { filesystem, openResizeFile } = fixture();
    filesystem.capabilitiesFor = vi.fn(async () => filesystem.capabilities);
    const controller = new AbortController();
    controller.abort(reason);
    await expect(admission.openRetainedResizeFile(filesystem, "/file", { signal: controller.signal })).rejects.toBe(reason);
    expect(filesystem.capabilitiesFor).not.toHaveBeenCalled();
    expect(openResizeFile).not.toHaveBeenCalled();
  });

  it("interrupts opaque metadata without opening later or retaining an abort listener", async () => {
    const { filesystem, openResizeFile } = fixture();
    const metadata = deferred<FileSystemCapabilities>();
    const entered = deferred<void>();
    filesystem.capabilitiesFor = vi.fn(() => { entered.resolve(); return metadata.promise; });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const outcome = admission.openRetainedResizeFile(filesystem, "/file", { signal: controller.signal }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    controller.abort(false);
    expect(await outcome).toEqual({ error: false });
    metadata.reject(new Error("late metadata failure"));
    await Promise.resolve();
    expect(openResizeFile).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("drains a late acquired resource and preserves cancellation over close failure", async () => {
    const { filesystem, handle } = fixture();
    const acquisition = deferred<FileResizeHandle>();
    const entered = deferred<void>();
    const closing = deferred<void>();
    const release = deferred<void>();
    filesystem.openResizeFile = vi.fn(() => { entered.resolve(); return acquisition.promise; });
    handle.close = vi.fn(async () => { closing.resolve(); await release.promise; throw "secondary"; });
    const controller = new AbortController();
    let settled = false;
    const outcome = admission.openRetainedResizeFile(filesystem, "/file", { signal: controller.signal }).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    await entered.promise;
    controller.abort(null);
    acquisition.resolve(handle);
    await closing.promise;
    expect(settled).toBe(false);
    release.resolve();
    expect(await outcome).toEqual({ error: null });
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("does not open after a selected capability getter cancels the caller", async () => {
    const controller = new AbortController();
    const { filesystem, handle, openResizeFile } = fixture({
      get retainedResize() { controller.abort(false); return true; },
    });
    await expect(admission.openRetainedResizeFile(filesystem, "/file", { signal: controller.signal })).rejects.toBe(false);
    expect(openResizeFile).not.toHaveBeenCalled();
    expect(handle.close).not.toHaveBeenCalled();
  });

  it("does not open after the post-query acquisition getter cancels the caller", async () => {
    const { filesystem, handle, openResizeFile } = fixture();
    const controller = new AbortController();
    let queried = false;
    filesystem.capabilitiesFor = async () => { queried = true; return filesystem.capabilities; };
    Object.defineProperty(filesystem, "openResizeFile", { get() {
      if (queried) controller.abort(null);
      return openResizeFile;
    } });
    await expect(admission.openRetainedResizeFile(filesystem, "/file", { signal: controller.signal })).rejects.toBe(null);
    expect(openResizeFile).not.toHaveBeenCalled();
    expect(handle.close).not.toHaveBeenCalled();
  });

  it("does not invoke a capability query whose getter cancels the caller", async () => {
    const { filesystem, openResizeFile } = fixture();
    const controller = new AbortController();
    const query = vi.fn(async () => filesystem.capabilities);
    Object.defineProperty(filesystem, "capabilitiesFor", { get() { controller.abort(0); return query; } });
    await expect(admission.openRetainedResizeFile(filesystem, "/file", { signal: controller.signal })).rejects.toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(openResizeFile).not.toHaveBeenCalled();
  });

  it.each([false, null, undefined, 0, "", NaN])("preserves acquisition rejection %j", async reason => {
    const { filesystem, handle } = fixture();
    filesystem.openResizeFile = vi.fn(async () => { throw reason; });
    await expect(admission.openRetainedResizeFile(filesystem, "/file", {})).rejects.toBe(reason);
    expect(handle.close).not.toHaveBeenCalled();
  });
});

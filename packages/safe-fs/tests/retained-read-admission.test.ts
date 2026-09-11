import { describe, expect, it, vi } from "vitest";
import type { FileReadHandle, FileSystemCapabilities } from "../src/contracts/filesystem.js";
import { openRetainedReadFile } from "../src/fs/capabilities.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

function fixture() {
  const filesystem = new MemoryFileSystem();
  const handle: FileReadHandle = {
    stat: vi.fn(async () => filesystem.stat("/")),
    read: vi.fn(async () => new Uint8Array()),
    close: vi.fn(async () => {}),
  };
  const acquire = vi.fn(async function (this: unknown) {
    expect(this).toBe(filesystem);
    return handle;
  });
  Object.defineProperty(filesystem, "openReadFile", { configurable: true, value: acquire });
  return { filesystem, handle, acquire };
}

describe("retained read admission", () => {
  for (const phase of ["availability", "query", "capability", "acquisition"]) {
    it.each([false, null, 0, "", NaN])(`does not dispatch after ${phase} lookup cancellation: %s`, async reason => {
      const { filesystem, acquire } = fixture();
      const controller = new AbortController();
      let queried = false;
      let metadataLookups = 0;
      const capabilities = Object.freeze({ get retainedRead() {
        if (phase === "capability") controller.abort(reason);
        return true;
      } });
      const query = vi.fn(async function (this: unknown) {
        expect(this).toBe(filesystem);
        queried = true;
        return capabilities;
      });
      Object.defineProperty(filesystem, "capabilitiesFor", { get() {
        metadataLookups++;
        if (phase === "query") controller.abort(reason);
        return query;
      } });
      Object.defineProperty(filesystem, "openReadFile", { get() {
        if (phase === "availability" || phase === "acquisition" && queried) controller.abort(reason);
        return acquire;
      } });
      await expect(openRetainedReadFile(filesystem, "/file", { signal: controller.signal })).rejects.toBe(reason);
      expect(acquire).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(phase === "availability" || phase === "query" ? 0 : 1);
      expect(metadataLookups).toBe(phase === "availability" ? 0 : 1);
    });
  }

  it.each([false, null, 0, "", NaN])("does not wait for opaque metadata after cancellation: %s", async reason => {
    const { filesystem, acquire } = fixture();
    const controller = new AbortController();
    let release!: (value: FileSystemCapabilities) => void;
    const metadata = new Promise<FileSystemCapabilities>(resolve => { release = resolve; });
    let entered!: () => void;
    const queried = new Promise<void>(resolve => { entered = resolve; });
    Object.defineProperty(filesystem, "capabilitiesFor", { value() { entered(); return metadata; } });
    let result: { error: unknown } | undefined;
    const opening = openRetainedReadFile(filesystem, "/file", { signal: controller.signal });
    const observed = opening.then(() => { throw new Error("Unexpected acquisition"); }, error => { result = { error }; });
    try {
      await queried;
      controller.abort(reason);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(result).toEqual({ error: reason });
      expect(acquire).not.toHaveBeenCalled();
    } finally {
      release(filesystem.capabilities);
      await observed;
    }
    expect(acquire).not.toHaveBeenCalled();
  });

  it("preserves the query/acquisition receivers and original caller options", async () => {
    const { filesystem, handle, acquire } = fixture();
    const options = { signal: new AbortController().signal };
    const query = vi.fn(async function (this: unknown, path: string, supplied: unknown) {
      expect(this).toBe(filesystem);
      expect(path).toBe("/file");
      expect(supplied).toBe(options);
      return filesystem.capabilities;
    });
    Object.defineProperty(filesystem, "capabilitiesFor", { value: query });
    expect(await openRetainedReadFile(filesystem, "/file", options)).toBe(handle);
    expect(acquire).toHaveBeenCalledExactlyOnceWith("/file", options);
    await handle.close();
  });

  it.each([undefined, null])("preserves nullish query fallback: %s", async value => {
    const { filesystem, handle, acquire } = fixture();
    Object.defineProperty(filesystem, "capabilitiesFor", { value: async () => value });
    expect(await openRetainedReadFile(filesystem, "/file", {})).toBe(handle);
    expect(acquire).toHaveBeenCalledTimes(1);
    await handle.close();
  });

  it.each([false, null, 0, "", NaN])("drains admitted acquisition and close before canceled settlement: %s", async reason => {
    const { filesystem, handle, acquire } = fixture();
    const controller = new AbortController();
    let entered!: () => void;
    const admitted = new Promise<void>(resolve => { entered = resolve; });
    let finishAcquisition!: (handle: FileReadHandle) => void;
    const acquisition = new Promise<FileReadHandle>(resolve => { finishAcquisition = resolve; });
    let closeEntered!: () => void;
    const closing = new Promise<void>(resolve => { closeEntered = resolve; });
    let finishClose!: () => void;
    const closed = new Promise<void>(resolve => { finishClose = resolve; });
    acquire.mockImplementation(() => { entered(); return acquisition; });
    const close = vi.fn(async () => { closeEntered(); await closed; throw new Error("secondary close failure"); });
    handle.close = close;
    const opening = openRetainedReadFile(filesystem, "/file", { signal: controller.signal });
    let result: { error: unknown } | undefined;
    const observed = opening.then(() => { throw new Error("Unexpected acquisition"); }, error => { result = { error }; });
    try {
      await admitted;
      controller.abort(reason);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(result).toBeUndefined();
      finishAcquisition(handle);
      await closing;
      expect(result).toBeUndefined();
      expect(close).toHaveBeenCalledTimes(1);
      finishClose();
      await observed;
      expect(result).toEqual({ error: reason });
    } finally {
      finishAcquisition(handle);
      finishClose();
      await observed;
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { openRetainedReadFile } from "../src/fs/capabilities.js";

const wrappers: Record<string, (filesystem: FileSystem) => FileSystem> = {
  readonly: filesystem => new ReadOnlyFileSystem(filesystem),
  mount: filesystem => new MountFileSystem({ root: filesystem }),
  device: filesystem => new DeviceFileSystem(filesystem),
  overlay: filesystem => new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: filesystem }),
  quota: filesystem => withFileSystemQuota(filesystem, { maxBytes: 32 }),
  scope: filesystem => scopeFileSystem(filesystem, vi.fn(), new AbortController().signal),
  nested: filesystem => new ReadOnlyFileSystem(new DeviceFileSystem(new MountFileSystem({
    root: withFileSystemQuota(filesystem, { maxBytes: 32 }),
  }))),
};

describe("retained directory read composition", () => {
  it.each([false, null, 0, "", NaN])("device refuses acquisition after method lookup cancellation: %s", async reason => {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/directory");
    const controller = new AbortController();
    let armed = false;
    const acquire = vi.fn(async () => ({
      stat: async () => memory.stat("/directory"),
      read: async () => new Uint8Array(),
      close: vi.fn(async () => {}),
    }));
    Object.defineProperty(memory, "openReadFile", { get() {
      if (armed) controller.abort(reason);
      return acquire;
    } });
    const devices = new DeviceFileSystem(memory);
    const open = devices.openReadFile;
    armed = true;
    await expect(open("/directory", { signal: controller.signal, allowDirectory: true })).rejects.toBe(reason);
    expect(acquire).not.toHaveBeenCalled();
  });

  for (const [name, wrap] of Object.entries(wrappers)) {
    it(`${name} preserves opt-in directory identity and ext4 64-bit end seeking`, async () => {
      const memory = new MemoryFileSystem();
      await memory.mkdir("/directory");
      const before = await memory.stat("/directory");
      const filesystem = wrap(memory);
      const options = { signal: new AbortController().signal, allowDirectory: true };
      const handle = await openRetainedReadFile(filesystem, "/directory", options);
      try {
        await memory.rename("/directory", "/moved");
        await memory.mkdir("/directory");
        expect(await handle.stat()).toMatchObject({ type: "directory", ino: before.ino });
        expect((await memory.stat("/directory")).ino).not.toBe(before.ino);
        await expect(handle.read(0, 1)).rejects.toMatchObject({ code: "EISDIR" });
        expect(handle.seekEnd).toBeTypeOf("function");
        expect(await handle.seekEnd!()).toBe(9223372036854775807n);
      } finally { await handle.close(); }
      await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
    });

    it.each([undefined, false])(`${name} keeps default directory rejection: %s`, async allowDirectory => {
      const memory = new MemoryFileSystem();
      await memory.mkdir("/directory");
      const filesystem = wrap(memory);
      await expect(openRetainedReadFile(filesystem, "/directory", {
        signal: new AbortController().signal,
        ...(allowDirectory === undefined ? {} : { allowDirectory }),
      })).rejects.toMatchObject({ code: "EISDIR" });
    });
  }
});

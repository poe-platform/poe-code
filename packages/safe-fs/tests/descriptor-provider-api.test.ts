import { describe, expect, it, vi } from "vitest";
import * as core from "../src/core.js";
import * as node from "../src/index.js";

for (const [name, surface] of [["core", core], ["node", node]] as const) describe(`${name} descriptor provider API`, () => {
  it("exposes the canonical provider builder on both entry points", () => {
    expect(surface.openFileDescriptor).toBeTypeOf("function");
    expect(surface.openFileDescriptor).toBe(core.openFileDescriptor);
  });

  it("opens a write-only character resource without consuming input for observation", async () => {
    const resource = { bytes: 0, closes: 0 };
    const read = vi.fn(async () => 0);
    const truncate = vi.fn(async () => {});
    const descriptor = await surface.openFileDescriptor<typeof resource>("/device", { access: "write", truncate: true }, {
      positionedRead: false, positionedWrite: false, truncate: false,
      openTruncate: true, readObservation: true, synchronization: "none",
    }, async options => {
      expect(options).toEqual({ access: "write", creation: "never", truncate: true, append: false, mode: 0o666 });
      expect(Object.isFrozen(options)).toBe(true);
      return {
        resource,
        async probeRead(retained) { expect(retained).toBe(resource); return "ready"; },
        async stat() { return { type: "character", size: 0, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
        read,
        async write(retained, bytes) { retained.bytes += bytes.length; return bytes.length; },
        truncate,
        async sync() {},
        async close(retained) { retained.closes++; },
      };
    });
    try {
      expect(await descriptor.probeRead!()).toBe("ready");
      expect((await descriptor.stat()).type).toBe("character");
      await expect(descriptor.read(new Uint8Array(1), null)).rejects.toMatchObject({ code: "EBADF" });
      await expect(descriptor.truncate(0)).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(read).not.toHaveBeenCalled();
      expect(truncate).not.toHaveBeenCalled();
      expect(await descriptor.write(Uint8Array.of(0, 255), null)).toBe(2);
      expect(resource.bytes).toBe(2);
    } finally { await descriptor.close(); }
    await descriptor.close();
    expect(resource.closes).toBe(1);
    await expect(descriptor.probeRead!()).rejects.toMatchObject({ code: "EBADF" });
  });

  it("rejects unsupported open flags before the provider acquires resources", async () => {
    const acquire = vi.fn(async () => { throw new Error("Must not acquire"); });
    await expect(surface.openFileDescriptor("/device", { access: "write", truncate: true }, {
      positionedRead: false, positionedWrite: false, truncate: false, synchronization: "none",
    }, acquire)).rejects.toMatchObject({ code: "ENOTSUP", syscall: "open" });
    expect(acquire).not.toHaveBeenCalled();
  });
});

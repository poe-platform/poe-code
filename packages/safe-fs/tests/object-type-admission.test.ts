import { describe, expect, it, vi } from "vitest";
import { BytePath, type ObjectFileType } from "../src/contracts/object.js";
import { ObjectAuthority } from "../src/fs/object-authority.js";

const path = new BytePath(Uint8Array.of(47, 255));

describe("retained native type admission", () => {
  it("serializes the directory type that it admitted, reading backend properties once", async () => {
    let reads = 0;
    const authority = new ObjectAuthority({ objects: {
      async open() { throw new Error("Not used"); },
      async readdir() {
        return [{ name: new BytePath(Uint8Array.of(255)),
          get type() { return (++reads === 1 ? "fifo" : "block") as ObjectFileType; } }];
      },
    } }, { maxHandles: 1 });
    try {
      expect(await authority.readdir(path, 1)).toEqual([{ name: [255], type: "fifo" }]);
      expect(reads).toBe(1);
    } finally { await authority.dispose(); }
  });
  it("retains admitted identity and type instead of consulting mutable backend properties", async () => {
    let identity = {};
    let type: ObjectFileType = "fifo";
    const close = vi.fn(async () => {});
    const authority = new ObjectAuthority({ objects: {
      specialFiles: { fifo: true },
      async open() {
        return {
          get identity() { return identity; },
          get type() { return type; },
          async stat() { return { type, size: 0n }; },
          close,
        };
      },
    } }, { maxHandles: 1 });
    try {
      const opened = await authority.open(path, { special: "fifo" });
      identity = {};
      type = "file";
      await expect(authority.stat(opened.handle)).rejects.toMatchObject({ code: "EIO" });
      await authority.close(opened.handle);
      expect(close).toHaveBeenCalledOnce();
    } finally { await authority.dispose(); }
  });
  it.each(["file", "block", "unknown"])("refuses a FIFO stat reported as %s", async type => {
    const authority = new ObjectAuthority({ objects: {
      specialFiles: { fifo: true },
      async open() {
        return {
          identity: {}, type: "fifo",
          async stat() { return { type: type as ObjectFileType, size: 0n }; },
          async close() {},
        };
      },
    } }, { maxHandles: 1 });
    try {
      const opened = await authority.open(path, { special: "fifo" });
      await expect(authority.stat(opened.handle)).rejects.toMatchObject({ code: "EIO" });
    } finally { await authority.dispose(); }
  });

  it("refuses unqualified directory entry types without changing the name bytes", async () => {
    const authority = new ObjectAuthority({ objects: {
      async open() { throw new Error("Not used"); },
      async readdir() { return [{ name: new BytePath(Uint8Array.of(255)), type: "block" as ObjectFileType }]; },
    } }, { maxHandles: 1 });
    try {
      await expect(authority.readdir(path, 1)).rejects.toMatchObject({ code: "EIO" });
    } finally { await authority.dispose(); }
  });
});

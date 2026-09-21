import { expect, it, vi } from "vitest";
import { BytePath, type RetainedFileObject } from "../src/contracts/object.js";
import { ObjectAuthority } from "../src/fs/object-authority.js";

it.each(["read", "write"] as const)("bounds the actual retained %s byte span despite a shadowed byteLength", async operation => {
  const bytes = Uint8Array.of(255, 128, 65);
  Object.defineProperty(bytes, "byteLength", { value: 1 });
  const write = vi.fn(async () => 3);
  const object: RetainedFileObject = {
    identity: {}, type: "file", close: async () => {},
    stat: async () => ({ type: "file", size: 3n }),
    read: async () => bytes, write,
  };
  const authority = new ObjectAuthority({ objects: { open: async () => object } }, { maxHandles: 1, maxIoBytes: 2 });
  const opened = await authority.open(new BytePath(Uint8Array.of(47, 97)), { access: "readwrite" });
  try {
    const result = operation === "read"
      ? authority.read(opened.handle, "9007199254740993", 2)
      : authority.write(opened.handle, "9007199254740993", bytes);
    await expect(result).rejects.toMatchObject({ code: operation === "read" ? "EIO" : "EINVAL" });
    expect(write).not.toHaveBeenCalled();
  } finally { await authority.dispose(); }
});

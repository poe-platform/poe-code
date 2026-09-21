import { expect, it, vi } from "vitest";
import { BytePath, type RetainedFileObject } from "../src/contracts/object.js";
import { ObjectAuthority } from "../src/fs/object-authority.js";
import { FsError } from "../src/contracts/errors.js";
import { createFsFromVolume, Volume } from "memfs";

const path = new BytePath(Uint8Array.of(47, 255));

it("appends to the retained object after rename, final unlink and pathname replacement", async () => {
  const volume = Volume.fromJSON({ "/original": "original" });
  const fs = createFsFromVolume(volume);
  fs.linkSync("/original", "/alias");
  const authority = new ObjectAuthority({ objects: {
    async open(path) {
      const fd = fs.openSync(Buffer.from(path.bytes()), "a+");
      return {
        identity: volume._core.fds[fd]!.node, type: "file",
        stat: async () => ({ type: "file", size: BigInt(fs.fstatSync(fd).size) }),
        append: async bytes => fs.writeSync(fd, bytes, 0, bytes.byteLength, null),
        async read(position, maxBytes) {
          if (position > BigInt(Number.MAX_SAFE_INTEGER)) throw new FsError("ENOTSUP");
          const bytes = Buffer.alloc(maxBytes);
          return bytes.subarray(0, fs.readSync(fd, bytes, 0, maxBytes, Number(position)));
        },
        close: async () => { fs.closeSync(fd); },
      };
    },
    rename: async (source, destination) => { fs.renameSync(Buffer.from(source.bytes()), Buffer.from(destination.bytes())); },
    unlink: async path => { fs.unlinkSync(Buffer.from(path.bytes())); },
  } }, { maxHandles: 2 });
  const path = (name: string) => new BytePath(new TextEncoder().encode(name));
  try {
    const original = await authority.open(path("/original"), { access: "readwrite" });
    const alias = await authority.open(path("/alias"), { access: "readwrite" });
    expect(original.object).toBe(alias.object);
    await authority.rename(path("/original"), path("/renamed"));
    await authority.unlink(path("/renamed"));
    await authority.unlink(path("/alias"));
    fs.writeFileSync("/original", "replacement");
    expect(await authority.append(alias.handle, Uint8Array.of(43))).toBe(1);
    expect(new TextDecoder().decode(await authority.read(original.handle, "0", 9))).toBe("original+");
    expect(fs.readFileSync("/original", "utf8")).toBe("replacement");
  } finally { await authority.dispose(); }
});

it("dispatches atomic retained append with owned bytes and partial progress, without probing EOF", async () => {
  const append = vi.fn(async (bytes: Uint8Array) => {
    expect(bytes).toEqual(Uint8Array.of(255, 128));
    return 1;
  });
  const stat = vi.fn();
  const write = vi.fn();
  const authority = new ObjectAuthority({ objects: { open: async () => ({
    identity: {}, type: "file", stat, write, append, close: async () => {},
  }) } }, { maxHandles: 1, maxIoBytes: 2 });
  try {
    const opened = await authority.open(path, { access: "write" });
    const bytes = Buffer.from([255, 128]);
    const result = authority.append(opened.handle, bytes);
    bytes.fill(0);
    expect(await result).toBe(1);
    expect(append).toHaveBeenCalledOnce();
    expect(stat).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  } finally { await authority.dispose(); }
});

it("refuses unsupported append and read-only handle access before backend mutation", async () => {
  const object: RetainedFileObject = { identity: {}, type: "file",
    stat: async () => ({ type: "file", size: 0n }), close: async () => {},
  };
  const authority = new ObjectAuthority({ objects: { open: async () => object } }, { maxHandles: 2 });
  try {
    const reader = await authority.open(path);
    const writer = await authority.open(path, { access: "write" });
    await expect(authority.append(reader.handle, Uint8Array.of(1))).rejects.toMatchObject({ code: "EBADF" });
    await expect(authority.append(writer.handle, Uint8Array.of(1))).rejects.toMatchObject({ code: "ENOTSUP" });
    await expect(authority.append(writer.object, Uint8Array.of(1))).rejects.toMatchObject({ code: "EBADF" });
  } finally { await authority.dispose(); }
});

it("bounds the intrinsic append span before copying or invoking the backend", async () => {
  const append = vi.fn(async () => 3);
  const authority = new ObjectAuthority({ objects: { open: async () => ({
    identity: {}, type: "file", stat: async () => ({ type: "file", size: 0n }), append, close: async () => {},
  }) } }, { maxHandles: 1, maxIoBytes: 2 });
  try {
    const opened = await authority.open(path, { access: "write" });
    const bytes = Uint8Array.of(1, 2, 3);
    Object.defineProperty(bytes, "byteLength", { value: 1 });
    await expect(authority.append(opened.handle, bytes)).rejects.toMatchObject({ code: "EINVAL" });
    await expect(authority.append(opened.handle, [1] as never)).rejects.toMatchObject({ code: "EINVAL" });
    expect(append).not.toHaveBeenCalled();
  } finally { await authority.dispose(); }
});

it.each([-1, 0.5, 3, NaN])("rejects an invalid append progress receipt %s", async count => {
  const authority = new ObjectAuthority({ objects: { open: async () => ({
    identity: {}, type: "file", stat: async () => ({ type: "file", size: 0n }),
    append: async () => count, close: async () => {},
  }) } }, { maxHandles: 1 });
  try {
    const opened = await authority.open(path, { access: "write" });
    await expect(authority.append(opened.handle, Uint8Array.of(1, 2))).rejects.toMatchObject({ code: "EIO" });
  } finally { await authority.dispose(); }
});

it("preserves the native append error", async () => {
  const authority = new ObjectAuthority({ objects: { open: async () => ({
    identity: {}, type: "file", stat: async () => ({ type: "file", size: 0n }),
    append: async () => { throw new FsError("ENOSPC"); }, close: async () => {},
  }) } }, { maxHandles: 1 });
  try {
    const opened = await authority.open(path, { access: "readwrite" });
    await expect(authority.append(opened.handle, Uint8Array.of(1))).rejects.toMatchObject({ code: "ENOSPC" });
  } finally { await authority.dispose(); }
});

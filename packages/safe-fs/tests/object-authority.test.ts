import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { BytePath, type RetainedFileObject, type ObjectFileSystem } from "../src/contracts/object.js";
import { ObjectAuthority } from "../src/fs/object-authority.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { FsError } from "../src/contracts/errors.js";

const path = (value: string) => new BytePath(new TextEncoder().encode(value));
function fixture() {
  const volume = Volume.fromJSON({ "/file": "original" });
  const fs = createFsFromVolume(volume);
  const close = vi.fn();
  const backend: ObjectFileSystem = {
    async open(value) {
      const fd = fs.openSync(Buffer.from(value.bytes()), "r+");
      // memfs recycles inode numbers while unlinked handles still retain Nodes.
      const identity = volume._core.fds[fd]!.node;
      return {
        identity,
        type: "file",
        async stat() {
          const stat = fs.fstatSync(fd);
          return { type: "file", size: BigInt(stat.size), nlink: BigInt(stat.nlink) };
        },
        async read(position, length) {
          if (position > BigInt(Number.MAX_SAFE_INTEGER)) throw new FsError("ENOTSUP");
          const bytes = Buffer.alloc(length);
          const count = fs.readSync(fd, bytes, 0, length, Number(position));
          return bytes.subarray(0, count);
        },
        async close() { close(); fs.closeSync(fd); },
      };
    },
  };
  return { fs, backend, close, authority: new ObjectAuthority({ objects: backend }, { maxHandles: 4 }) };
}

describe("retained object authority", () => {
  it("keeps operations and cleanup on the acquired capability after its public methods change", async () => {
    const read = vi.fn(async function (this: RetainedFileObject) {
      expect(this).toBe(object);
      return Uint8Array.of(255);
    });
    const close = vi.fn(async function (this: RetainedFileObject) {
      expect(this).toBe(object);
    });
    const object: RetainedFileObject = {
      identity: {}, type: "file", read, close,
      stat: async () => ({ type: "file", size: 1n }),
    };
    const authority = new ObjectAuthority({ objects: { open: async () => object } }, { maxHandles: 1 });
    const opened = await authority.open(path("/file"));
    const replacementRead = vi.fn(async () => Uint8Array.of(0));
    const replacementClose = vi.fn(async () => {});
    object.read = replacementRead;
    object.close = replacementClose;
    try {
      expect(await authority.read(opened.handle, "0", 1)).toEqual(Uint8Array.of(255));
    } finally { await authority.dispose(); }
    expect(read).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(replacementRead).not.toHaveBeenCalled();
    expect(replacementClose).not.toHaveBeenCalled();
  });
  it("owns cleanup before inspecting a rejected retained identity", async () => {
    const close = vi.fn(async () => {});
    const replacementClose = vi.fn(async () => {});
    const failure = new FsError("ENOTSUP");
    const object: RetainedFileObject = {
      get identity(): object { object.close = replacementClose; throw failure; },
      type: "file", stat: async () => ({ type: "file", size: 0n }), close,
    };
    const authority = new ObjectAuthority({ objects: { open: async () => object } }, { maxHandles: 1 });
    await expect(authority.open(path("/file"))).rejects.toBe(failure);
    await authority.dispose();
    expect(close).toHaveBeenCalledOnce();
    expect(replacementClose).not.toHaveBeenCalled();
  });
  it("releases every retained alias even when a backend close throws synchronously", async () => {
    const failure = new FsError("EIO");
    const close = vi.fn((): Promise<void> => { throw failure; })
      .mockImplementationOnce(() => { throw failure; })
      .mockImplementationOnce(async () => {});
    const identity = {};
    const authority = new ObjectAuthority({ objects: { open: async () => ({
      identity, type: "file", stat: async () => ({ type: "file", size: 0n }), close,
    }) } }, { maxHandles: 2 });
    const first = await authority.open(path("/file"));
    const alias = await authority.open(path("/alias"));
    expect(first.object).toBe(alias.object);
    await expect(authority.dispose()).rejects.toMatchObject({ errors: [failure] });
    expect(close).toHaveBeenCalledTimes(2);
    await expect(authority.read(alias.handle, "0", 1)).rejects.toMatchObject({ code: "EBADF" });
  });
  it("keeps access rights per open handle even when aliases expose all backend methods", async () => {
    const read = vi.fn(async () => Uint8Array.of(88));
    const write = vi.fn(async () => 1);
    const truncate = vi.fn(async () => {});
    const identity = {};
    const authority = new ObjectAuthority({ objects: { open: async () => ({
      identity, type: "file", read, write, truncate,
      stat: async () => ({ type: "file", size: 0n }), close: async () => {},
    }) } }, { maxHandles: 3 });
    const reader = await authority.open(path("/file"));
    const writer = await authority.open(path("/alias"), { access: "write" });
    const both = await authority.open(path("/alias"), { access: "readwrite" });
    expect(reader.object).toBe(writer.object);
    await expect(authority.write(reader.handle, "0", Uint8Array.of(88))).rejects.toMatchObject({ code: "EBADF" });
    await expect(authority.truncate(reader.handle, "1")).rejects.toMatchObject({ code: "EBADF" });
    await expect(authority.read(writer.handle, "0", 1)).rejects.toMatchObject({ code: "EBADF" });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(truncate).not.toHaveBeenCalled();
    expect(await authority.read(reader.handle, "0", 1)).toEqual(Uint8Array.of(88));
    expect(await authority.write(writer.handle, "0", Uint8Array.of(88))).toBe(1);
    await authority.truncate(writer.handle, "1");
    expect(await authority.read(both.handle, "0", 1)).toEqual(Uint8Array.of(88));
    expect(await authority.write(both.handle, "0", Uint8Array.of(88))).toBe(1);
    await authority.dispose();
  });
  it.each([null, [], 42].map(value => [value]))("rejects malformed metadata before backend mutation: %j", async changes => {
    const metadata = vi.fn(async () => {});
    const authority = new ObjectAuthority({ objects: { open: async () => ({
      identity: {}, type: "file", metadata,
      stat: async () => ({ type: "file", size: 0n }), close: async () => {},
    }) } }, { maxHandles: 1 });
    const handle = await authority.open(path("/file"));
    await expect(authority.metadata(handle.handle, changes as never)).rejects.toMatchObject({ code: "EINVAL" });
    expect(metadata).not.toHaveBeenCalled();
    await authority.dispose();
  });
  it("rejects unrecognized access and special kinds before acquisition", async () => {
    const open = vi.fn(async () => ({ identity: {}, type: "file" as const,
      stat: async () => ({ type: "file" as const, size: 0n }), close: async () => {},
    }));
    const authority = new ObjectAuthority({ objects: { open, specialFiles: { file: true } as never } }, { maxHandles: 1 });
    for (const options of [{ access: "execute" }, { special: "file" }, { special: "" }]) {
      await expect(authority.open(path("/file"), options as never)).rejects.toMatchObject({ code: "EINVAL" });
    }
    expect(open).not.toHaveBeenCalled();
    await authority.dispose();
  });
  it("owns acknowledged reads when a backend reuses its Buffer across exact positional reads", async () => {
    const buffer = Buffer.from([255, 128]);
    const read = vi.fn(async (position: bigint) => {
      buffer[1] = position === 9007199254740993n ? 128 : 129;
      return buffer;
    });
    const authority = new ObjectAuthority({ objects: { open: async () => ({
      identity: {}, type: "file", read,
      stat: async () => ({ type: "file", size: 9007199254740995n }), close: async () => {},
    }) } }, { maxHandles: 1, maxIoBytes: 2 });
    const handle = await authority.open(new BytePath(Uint8Array.of(47, 255)));
    const first = await authority.read(handle.handle, "9007199254740993", 2);
    const second = await authority.read(handle.handle, "9007199254740994", 2);
    expect(first).toEqual(Uint8Array.of(255, 128));
    second.fill(0);
    expect(buffer).toEqual(Buffer.from([255, 129]));
    expect(first).toEqual(Uint8Array.of(255, 128));
    await authority.dispose();
  });
  it("issues equal object IDs for hardlinks and keeps separate open ownership after rename/unlink", async () => {
    const { fs, authority, close } = fixture();
    fs.linkSync("/file", "/alias");
    const first = await authority.open(path("/file"));
    const alias = await authority.open(path("/alias"));
    expect(first.object).toBe(alias.object);
    expect(first.handle).not.toBe(alias.handle);
    expect(await authority.stat(first.handle)).toMatchObject({ nlink: "2" });
    fs.renameSync("/file", "/renamed");
    fs.unlinkSync("/renamed"); fs.unlinkSync("/alias");
    fs.writeFileSync("/file", "replacement");
    const replacement = await authority.open(path("/file"));
    expect(replacement.object).not.toBe(first.object);
    expect(await authority.stat(first.handle)).toMatchObject({ nlink: "0" });
    expect(await authority.stat(replacement.handle)).toMatchObject({ nlink: "1" });
    expect(new TextDecoder().decode(await authority.read(first.handle, "0", 8))).toBe("original");
    await authority.close(first.handle);
    await expect(authority.read(first.handle, "0", 1)).rejects.toMatchObject({ code: "EBADF" });
    expect(new TextDecoder().decode(await authority.read(alias.handle, "0", 8))).toBe("original");
    await authority.dispose();
    expect(close).toHaveBeenCalledTimes(3);
  });
  it("passes exact offsets and byte paths without conversion and preserves backend errno", async () => {
    const read = vi.fn(async () => Uint8Array.of(88));
    const link = vi.fn(async () => { throw new FsError("EXDEV"); });
    const truncate = vi.fn(async () => {});
    const metadata = vi.fn(async () => {});
    const object: RetainedFileObject = { identity: {}, type: "file", read, link, truncate, metadata,
      stat: async () => ({ type: "file", size: 9007199254740994n }), close: async () => {} };
    const open = vi.fn(async (_path: BytePath) => object);
    const authority = new ObjectAuthority({ objects: { open } }, { maxHandles: 1 });
    const raw = new BytePath(Uint8Array.of(47, 255));
    const handle = await authority.open(raw, { access: "readwrite" });
    expect(open.mock.calls[0]![0].bytes()).toEqual(raw.bytes());
    await authority.read(handle.handle, "9007199254740993", 1);
    expect(read).toHaveBeenCalledWith(9007199254740993n, 1);
    await authority.truncate(handle.handle, "9007199254740994");
    expect(truncate).toHaveBeenCalledWith(9007199254740994n);
    await authority.metadata(handle.handle, { mode: 0o640, uid: 1000, gid: 1000, mtimeNs: "1234567890000000001" });
    expect(metadata).toHaveBeenCalledWith(expect.objectContaining({ mtimeNs: 1234567890000000001n }));
    await expect(authority.link(handle.handle, raw)).rejects.toMatchObject({ code: "EXDEV" });
    expect(await authority.stat(handle.handle)).toEqual({ type: "file", size: "9007199254740994" });
    await authority.dispose();
  });
  it("refuses unsupported backends, operations, special endpoints and handle confusion", async () => {
    const unsupported = new ObjectAuthority(new MemoryFileSystem(), { maxHandles: 1 });
    await expect(unsupported.open(path("/file"))).rejects.toMatchObject({ code: "ENOTSUP" });
    const { authority } = fixture();
    await expect(authority.open(path("/file"), { special: "fifo" })).rejects.toMatchObject({ code: "ENOTSUP" });
    const handle = await authority.open(path("/file"));
    await expect(authority.read(handle.object, "0", 1)).rejects.toMatchObject({ code: "EBADF" });
    await expect(authority.truncate(handle.handle, "1")).rejects.toMatchObject({ code: "EBADF" });
    const writer = await authority.open(path("/file"), { access: "write" });
    await expect(authority.truncate(writer.handle, "1")).rejects.toMatchObject({ code: "ENOTSUP" });
    await expect(authority.read(handle.handle, "9007199254740993", 1)).rejects.toMatchObject({ code: "ENOTSUP" });
    await expect(authority.read(handle.handle, "0", -1)).rejects.toMatchObject({ code: "EINVAL" });
    await authority.dispose();
    await expect(authority.open(path("/file"))).rejects.toMatchObject({ code: "EBADF" });
  });
  it("snapshots open admission before queueing and while acquisition is pending", async () => {
    let finish!: (object: RetainedFileObject) => void;
    const open = vi.fn((_path: BytePath, _options?: { readonly access?: string; readonly special?: string }) => new Promise<RetainedFileObject>(resolve => { finish = resolve; }));
    const authority = new ObjectAuthority({ objects: { specialFiles: { fifo: true }, open } }, { maxHandles: 1 });
    const options: { access: "read" | "readwrite"; special: "fifo" | "socket" } = { access: "read", special: "fifo" };
    const opening = authority.open(path("/fifo"), options);
    options.access = "readwrite";
    await Promise.resolve();
    expect(open.mock.calls[0]![1]).toEqual({ access: "read", special: "fifo" });
    options.special = "socket";
    finish({ identity: {}, type: "fifo", stat: async () => ({ type: "fifo", size: 0n }), close: async () => {} });
    await opening;
    await authority.dispose();
  });
  it.each([{ uid: NaN }, { gid: Infinity }, { mode: 1.5 }, { mode: 65536 }, { uid: 9007199254740992 }])("refuses lossy stat numbers %j", async fields => {
    const authority = new ObjectAuthority({ objects: { open: async () => ({ identity: {}, type: "file", close: async () => {},
      stat: async () => ({ type: "file", size: 0n, ...fields }),
    }) } }, { maxHandles: 1 });
    const handle = await authority.open(path("/file"));
    await expect(authority.stat(handle.handle)).rejects.toMatchObject({ code: "EINVAL" });
    await authority.dispose();
  });
  it("never serializes process-local stat identity or unqualified inode tuples", async () => {
    const authority = new ObjectAuthority({ objects: { open: async () => ({
      identity: {}, type: "file", close: async () => {},
      stat: async () => ({ type: "file", size: 9007199254740993n, mode: 0o100640,
        atimeNs: -1n, mtimeNs: 1234567890000000001n, ctimeNs: 1234567890000000002n,
        identityScope: { private: "authority" }, dev: 1, ino: 9007199254740992 }),
    }) } }, { maxHandles: 1 });
    const handle = await authority.open(path("/file"));
    expect(JSON.parse(JSON.stringify(await authority.stat(handle.handle)))).toEqual({
      type: "file", size: "9007199254740993", mode: 0o100640,
      atimeNs: "-1", mtimeNs: "1234567890000000001", ctimeNs: "1234567890000000002",
    });
    await authority.dispose();
  });
  it("copies queued Buffer writes and acknowledges partial progress at the exact offset", async () => {
    const write = vi.fn(async () => 1);
    const authority = new ObjectAuthority({ objects: { open: async () => ({
      identity: {}, type: "file", stat: async () => ({ type: "file", size: 0n }), write, close: async () => {},
    }) } }, { maxHandles: 1, maxIoBytes: 2 });
    const handle = await authority.open(path("/file"), { access: "write" });
    const bytes = Buffer.from([42, 43]);
    const writing = authority.write(handle.handle, "9007199254740993", bytes);
    bytes.fill(0);
    expect(await writing).toBe(1);
    expect(write).toHaveBeenCalledWith(9007199254740993n, Uint8Array.of(42, 43));
    await expect(authority.write(handle.handle, "0", new Uint8Array(3))).rejects.toMatchObject({ code: "EINVAL" });
    await authority.dispose();
  });
  it("rejects regular-file substitution for an admitted FIFO and preserves ESPIPE", async () => {
    const close = vi.fn(async () => {});
    const object: RetainedFileObject = { identity: {}, type: "file", stat: async () => ({ type: "file", size: 0n }), close };
    const open = vi.fn(async (_path: BytePath) => object);
    const authority = new ObjectAuthority({ objects: { specialFiles: { fifo: true }, open } }, { maxHandles: 1 });
    await expect(authority.open(path("/fifo"), { special: "fifo" })).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(close).toHaveBeenCalledOnce();
    open.mockResolvedValue({ ...object, type: "fifo", read: async () => { throw new FsError("ESPIPE"); } });
    const fifo = await authority.open(path("/fifo"), { special: "fifo" });
    await expect(authority.read(fifo.handle, "0", 1)).rejects.toMatchObject({ code: "ESPIPE" });
    await authority.dispose();
  });
  it("rejects foreign authority IDs and drains all closes after one cleanup fails", async () => {
    const { authority } = fixture();
    const other = fixture().authority;
    const local = await authority.open(path("/file"));
    const foreign = await other.open(path("/file"));
    await expect(authority.read(foreign.handle, "0", 1)).rejects.toMatchObject({ code: "EBADF" });
    expect(local.object).not.toBe(foreign.object);
    await authority.dispose(); await other.dispose();
    const close = vi.fn().mockRejectedValueOnce(new FsError("EIO")).mockResolvedValue(undefined);
    const failing = new ObjectAuthority({ objects: { open: async () => ({ identity: {}, type: "file", stat: async () => ({ type: "file", size: 0n }), close }) } }, { maxHandles: 2 });
    await failing.open(path("/file")); await failing.open(path("/file"));
    await expect(failing.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("drains a late acquisition during disposal and limits retained resources", async () => {
    let finish!: (object: RetainedFileObject) => void;
    const close = vi.fn(async () => {});
    const authority = new ObjectAuthority({ objects: { open: () => new Promise(resolve => { finish = resolve; }) } }, { maxHandles: 1 });
    const opening = authority.open(path("/file"));
    await Promise.resolve();
    const disposed = authority.dispose();
    finish({ identity: {}, type: "file", stat: async () => ({ type: "file", size: 0n }), close });
    await opening; await disposed;
    expect(close).toHaveBeenCalledOnce();
    const { backend } = fixture();
    const bounded = new ObjectAuthority({ objects: backend }, { maxHandles: 1 });
    await bounded.open(path("/file"));
    await expect(bounded.open(path("/file"))).rejects.toMatchObject({ code: "EMFILE" });
    await bounded.dispose();
  });
});

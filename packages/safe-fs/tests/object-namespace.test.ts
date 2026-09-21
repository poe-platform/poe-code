import { describe, expect, it, vi } from "vitest";
import { BytePath, type ObjectFileSystem } from "../src/contracts/object.js";
import { FsError } from "../src/contracts/errors.js";
import { ObjectAuthority } from "../src/fs/object-authority.js";
import { createFsFromVolume, Volume } from "memfs";

const raw = () => new BytePath(Uint8Array.of(47, 255, 128));
const unsupported: ObjectFileSystem = { async open() { throw new FsError("ENOTSUP"); } };

describe("authority byte namespace operations", () => {
  it("owns namespace paths before queued operations can observe changed carriers", async () => {
    const observed: number[][] = [];
    const backend: ObjectFileSystem = {
      ...unsupported,
      async unlink(path) { observed.push(Array.from(path.bytes())); },
      async rename(source, destination) {
        observed.push(Array.from(source.bytes()), Array.from(destination.bytes()));
      },
    };
    const authority = new ObjectAuthority({ objects: backend }, { maxHandles: 1 });
    const source = raw();
    const destination = new BytePath(Uint8Array.of(47, 254));
    const unlinking = authority.unlink(source);
    const renaming = authority.rename(source, destination);
    source.bytes = () => Uint8Array.of(47, 97);
    destination.bytes = () => Uint8Array.of(47, 98);
    try {
      await unlinking;
      await renaming;
      expect(observed).toEqual([[47, 255, 128], [47, 255, 128], [47, 254]]);
    } finally { await authority.dispose(); }
  });
  it("owns open, retained-link and listing paths at admission", async () => {
    const observed: number[][] = [];
    const authority = new ObjectAuthority({ objects: {
      async open(path) {
        observed.push(Array.from(path.bytes()));
        return { identity: {}, type: "file", stat: async () => ({ type: "file", size: 0n }),
          async link(path) { observed.push(Array.from(path.bytes())); }, close: async () => {} };
      },
      async readdir(path) { observed.push(Array.from(path.bytes())); return []; },
    } }, { maxHandles: 1 });
    const openingPath = raw();
    const opening = authority.open(openingPath);
    openingPath.bytes = () => Uint8Array.of(47, 97);
    try {
      const handle = await opening;
      const destination = raw();
      const linking = authority.link(handle.handle, destination);
      const listing = authority.readdir(destination, 0);
      destination.bytes = () => Uint8Array.of(47, 98);
      await linking;
      await listing;
      expect(observed).toEqual([[47, 255, 128], [47, 255, 128], [47, 255, 128]]);
    } finally { await authority.dispose(); }
  });
  it("pins the issued authority namespace and endpoint capabilities while retaining live objects", async () => {
    const identity = {};
    const open = vi.fn(async function (this: ObjectFileSystem) {
      expect(this).toBe(backend);
      return { identity, type: "file" as const, stat: async () => ({ type: "file" as const, size: 0n }), close: async () => {} };
    });
    const rename = vi.fn(async function (this: ObjectFileSystem) {
      expect(this).toBe(backend);
      throw new FsError("EXDEV");
    });
    const unlink = vi.fn(async () => {});
    const readdir = vi.fn(async () => [{ name: raw(), type: "file" as const }]);
    const specialFiles = { fifo: false };
    const backend: ObjectFileSystem = { open, rename, unlink, readdir, specialFiles };
    const filesystem = { objects: backend };
    const authority = new ObjectAuthority(filesystem, { maxHandles: 2 });
    const replacement = vi.fn(async () => { throw new Error("Foreign authority invoked"); });
    try {
      const original = await authority.open(raw());
      backend.open = replacement;
      backend.rename = replacement;
      backend.unlink = replacement;
      backend.readdir = replacement;
      specialFiles.fifo = true;
      filesystem.objects = { open: replacement };
      const alias = await authority.open(raw());
      expect(alias.object).toBe(original.object);
      await expect(authority.rename(raw(), raw())).rejects.toMatchObject({ code: "EXDEV" });
      await authority.unlink(raw());
      // A component, rather than the absolute fixture path.
      readdir.mockResolvedValue([{ name: new BytePath(Uint8Array.of(255, 128)), type: "file" }]);
      expect(await authority.readdir(raw(), 1)).toEqual([{ name: [255, 128], type: "file" }]);
      await expect(authority.open(raw(), { special: "fifo" })).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(open).toHaveBeenCalledTimes(2);
      expect(unlink).toHaveBeenCalledOnce();
      expect(replacement).not.toHaveBeenCalled();
    } finally { await authority.dispose(); }
  });

  it("keeps an unsupported byte namespace unsupported for an existing authority", async () => {
    const filesystem: { objects?: ObjectFileSystem } = {};
    const authority = new ObjectAuthority(filesystem, { maxHandles: 1 });
    const open = vi.fn(async () => { throw new Error("Late backend invoked"); });
    filesystem.objects = { open };
    try {
      await expect(authority.open(raw())).rejects.toMatchObject({ code: "ENOTSUP" });
      expect(open).not.toHaveBeenCalled();
    } finally { await authority.dispose(); }
  });
  it.each([null, {}, new Array(1), [undefined], [{ name: { bytes: () => Uint8Array.of(0) }, type: "file" }],
    [{ name: { bytes: () => new Uint8Array() }, type: "file" }]].map(entries => [entries]))(
    "refuses malformed backend listings instead of emitting invalid wire names: %j", async entries => {
      const authority = new ObjectAuthority({ objects: { ...unsupported,
        async readdir() { return entries as never; },
      } }, { maxHandles: 1 });
      try {
        await expect(authority.readdir(raw(), 1)).rejects.toMatchObject({ code: "EIO" });
      } finally { await authority.dispose(); }
    });

  it.each([false, true, undefined])("preserves the canonical rename effect receipt: %s", async moved => {
    const receipt = moved === undefined ? undefined : { moved };
    const source = raw();
    const destination = new BytePath(Uint8Array.of(47, 254));
    const rename = vi.fn(async () => receipt);
    const authority = new ObjectAuthority({ objects: { ...unsupported, rename } }, { maxHandles: 1 });
    try {
      expect(await authority.rename(source, destination)).toEqual(receipt);
      expect(rename).toHaveBeenCalledWith(source, destination);
    } finally { await authority.dispose(); }
  });

  it("keeps retained hardlink aliases alive across authority rename/unlink", async () => {
    const volume = Volume.fromJSON({ "/original": "retained" });
    const fs = createFsFromVolume(volume);
    fs.linkSync("/original", "/alias");
    const backend: ObjectFileSystem = {
      async open(path) {
        const fd = fs.openSync(Buffer.from(path.bytes()), "r");
        return {
          identity: volume._core.fds[fd]!.node, type: "file",
          async stat() { return { type: "file", size: BigInt(fs.fstatSync(fd).size) }; },
          async read(position, count) {
            if (position > BigInt(Number.MAX_SAFE_INTEGER)) throw new FsError("ENOTSUP");
            const bytes = Buffer.alloc(count);
            return bytes.subarray(0, fs.readSync(fd, bytes, 0, count, Number(position)));
          },
          async close() { fs.closeSync(fd); },
        };
      },
      async rename(source, destination) { fs.renameSync(Buffer.from(source.bytes()), Buffer.from(destination.bytes())); },
      async unlink(path) { fs.unlinkSync(Buffer.from(path.bytes())); },
    };
    const path = (name: string) => new BytePath(new TextEncoder().encode(name));
    const authority = new ObjectAuthority({ objects: backend }, { maxHandles: 2 });
    try {
      const original = await authority.open(path("/original"));
      const alias = await authority.open(path("/alias"));
      expect(alias.object).toBe(original.object);
      await authority.rename(path("/original"), path("/renamed"));
      await authority.unlink(path("/renamed"));
      await authority.unlink(path("/alias"));
      fs.writeFileSync("/original", "replacement");
      for (const handle of [original, alias]) {
        expect(Array.from(await authority.read(handle.handle, "0", 8))).toEqual(Array.from(new TextEncoder().encode("retained")));
      }
    } finally { await authority.dispose(); }
  });

  it("awaits byte rename/unlink and preserves native failures", async () => {
    const rename = vi.fn(async (_source: BytePath, _destination: BytePath) => { throw new FsError("EXDEV"); });
    const unlink = vi.fn(async (_path: BytePath) => { throw new FsError("EILSEQ"); });
    const authority = new ObjectAuthority({ objects: { ...unsupported, rename, unlink } }, { maxHandles: 1 });
    await expect(authority.rename(raw(), raw())).rejects.toMatchObject({ code: "EXDEV" });
    expect(rename.mock.calls[0]!.map(path => path.bytes())).toEqual([raw().bytes(), raw().bytes()]);
    await expect(authority.unlink(raw())).rejects.toMatchObject({ code: "EILSEQ" });
    expect(unlink.mock.calls[0]![0].bytes()).toEqual(raw().bytes());
    await authority.dispose();
    await expect(authority.unlink(raw())).rejects.toMatchObject({ code: "EBADF" });
  });

  it("returns owned octet names on the wire without UTF-8 replacement", async () => {
    const name = new BytePath(Uint8Array.of(255, 128));
    const readdir = vi.fn(async () => [{ name, type: "file" as const }]);
    const authority = new ObjectAuthority({ objects: { ...unsupported, readdir } }, { maxHandles: 1 });
    const result = await authority.readdir(raw(), 2);
    expect(JSON.parse(JSON.stringify(result))).toEqual([{ name: [255, 128], type: "file" }]);
    expect(readdir).toHaveBeenCalledWith(raw(), { maxEntries: 2 });
    await authority.dispose();
  });

  it.each([[47], [46], [46, 46], [97, 47, 98]].map(bytes => [bytes]))("rejects non-component directory names %j", async bytes => {
    const authority = new ObjectAuthority({ objects: { ...unsupported,
      async readdir() { return [{ name: new BytePath(Uint8Array.from(bytes)), type: "file" }]; },
    } }, { maxHandles: 1 });
    await expect(authority.readdir(raw(), 1)).rejects.toMatchObject({ code: "EIO" });
    await authority.dispose();
  });

  it("bounds directory admission and rejects overflow rather than truncating", async () => {
    const readdir = vi.fn(async () => Array.from({ length: 2 }, () => ({ name: new BytePath(Uint8Array.of(97)), type: "file" as const })));
    const authority = new ObjectAuthority({ objects: { ...unsupported, readdir } }, { maxHandles: 1 });
    for (const limit of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(authority.readdir(raw(), limit)).rejects.toMatchObject({ code: "EINVAL" });
    }
    expect(readdir).not.toHaveBeenCalled();
    await expect(authority.readdir(raw(), 1)).rejects.toMatchObject({ code: "EFBIG" });
    await authority.dispose();
  });

  it("refuses legacy-only and unqualified namespace operations", async () => {
    for (const filesystem of [{}, { objects: unsupported }]) {
      const authority = new ObjectAuthority(filesystem, { maxHandles: 1 });
      await expect(authority.rename(raw(), raw())).rejects.toMatchObject({ code: "ENOTSUP" });
      await expect(authority.unlink(raw())).rejects.toMatchObject({ code: "ENOTSUP" });
      await expect(authority.readdir(raw(), 1)).rejects.toMatchObject({ code: "ENOTSUP" });
      await authority.dispose();
    }
  });
});

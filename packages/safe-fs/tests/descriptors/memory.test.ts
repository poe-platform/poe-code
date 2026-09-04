import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("memory canonical descriptors", () => {
  it("keeps cursor independent of positioned operations and retains tails", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", bytes("abcdef"));
    const fd = await fs.open("/file", { access: "readwrite" });
    const buffer = new Uint8Array(2);
    expect(await fd.read(buffer, null)).toBe(2);
    expect(buffer).toEqual(bytes("ab"));
    await fd.write(bytes("Z"), 4);
    await fd.read(buffer, 4);
    expect(buffer).toEqual(bytes("Zf"));
    await fd.read(buffer, null);
    expect(buffer).toEqual(bytes("cd"));
    await fd.write(bytes("!"), null);
    expect(await fs.readFile("/file")).toEqual(bytes("abcd!f"));
    await fd.truncate(8);
    expect(await fs.readFile("/file")).toEqual(new Uint8Array([97, 98, 99, 100, 33, 102, 0, 0]));
    await fd.close();
    await expect(fd.stat()).rejects.toMatchObject({ code: "EBADF" });
  });

  it("checks permissions only at acquisition and keeps inode identity after replacement", async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/dir");
    const fd = await fs.open("/dir/file", { access: "readwrite", creation: "exclusive", mode: 0 });
    await fd.write(bytes("old"), null);
    await expect(fs.open("/dir/file", { access: "read" })).rejects.toMatchObject({ code: "EACCES" });
    const original = await fd.stat();
    await fs.link("/dir/file", "/alias");
    await fs.rm("/dir/file");
    await fs.rm("/alias");
    await fs.writeFile("/dir/file", bytes("new"));
    await fs.chmod("/dir", 0);
    await fd.write(bytes("!"), 0);
    expect(await fd.stat()).toMatchObject({ ino: original.ino, nlink: 0, size: 3 });
    const buffer = new Uint8Array(3);
    await fd.read(buffer, 0);
    expect(buffer).toEqual(bytes("!ld"));
    await fd.close();
    await fs.chmod("/dir", 0o755);
    expect(await fs.readFile("/dir/file")).toEqual(bytes("new"));
  });

  it("supports append and volatile synchronization without pretending durability", async () => {
    const fs = new MemoryFileSystem();
    const first = await fs.open("/file", { access: "write", creation: "ifMissing", append: true, synchronization: "data" });
    const second = await fs.open("/file", { access: "write", append: true });
    await Promise.all([first.write(bytes("ab"), null), second.write(bytes("cd"), null)]);
    expect(await fs.readFile("/file")).toEqual(bytes("abcd"));
    expect(first.capabilities).toMatchObject({ positionedRead: false, positionedWrite: false, synchronization: "volatile" });
    await expect(first.write(bytes("!"), 0)).rejects.toMatchObject({ code: "EINVAL" });
    await expect(first.read(new Uint8Array(1), null)).rejects.toMatchObject({ code: "EBADF" });
    await first.sync(true);
    await second.sync(false);
    await Promise.all([first.close(), second.close()]);
  });

  it("enforces exact creation, canonical traversal, and non-file errors", async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/dir");
    await fs.symlink("/missing", "/link");
    await expect(fs.open("/missing", { access: "write" })).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.open("/link", { access: "write", creation: "exclusive" })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(fs.open("/dir", { access: "read" })).rejects.toMatchObject({ code: "EISDIR" });
    await expect(fs.open("/new/", { access: "write", creation: "ifMissing" })).rejects.toMatchObject({ code: "ENOENT" });
    const fd = await fs.open("/dir/../link", { access: "write", creation: "ifMissing" });
    await fd.write(bytes("ok"), 3);
    expect(await fs.readFile("/missing")).toEqual(new Uint8Array([0, 0, 0, 111, 107]));
    await expect(fd.write(bytes("xx"), Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({ code: "EFBIG" });
    await fd.close();
  });

  it("charges unlinked open inodes once until final close, including growth and truncate", async () => {
    const fs = new MemoryFileSystem({ maxBytes: 8 });
    await fs.writeFile("/file", bytes("1234"));
    await fs.link("/file", "/alias");
    const first = await fs.open("/file", { access: "readwrite" });
    const second = await fs.open("/alias", { access: "readwrite" });
    await fs.rm("/file");
    await fs.rm("/alias");
    await fs.writeFile("/file", bytes("5678"));
    await expect(first.write(bytes("!"), 4)).rejects.toMatchObject({ code: "ENOSPC" });
    await first.truncate(2);
    await first.write(bytes("ab"), 2);
    await expect(fs.appendFile("/file", bytes("!"))).rejects.toMatchObject({ code: "ENOSPC" });
    await first.close();
    await expect(fs.appendFile("/file", bytes("!"))).rejects.toMatchObject({ code: "ENOSPC" });
    await second.close();
    await second.close();
    await fs.appendFile("/file", bytes("abcd"));
    await expect(fs.appendFile("/file", bytes("!"))).rejects.toMatchObject({ code: "ENOSPC" });
  });

  it("accounts hardlinks, recursive removal, overwrite rename, and retained streaming writers", async () => {
    const fs = new MemoryFileSystem({ maxBytes: 6 });
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/file", bytes("abc"));
    await fs.link("/dir/file", "/dir/alias");
    const fd = await fs.open("/dir/file", { access: "write" });
    await fs.rm("/dir", { recursive: true });
    await fs.writeFile("/new", bytes("def"));
    await expect(fd.truncate(4)).rejects.toMatchObject({ code: "ENOSPC" });
    await fd.close();
    await fs.writeFile("/target", bytes("ghi"));
    await fs.rename("/new", "/target");
    await fs.writeFile("/free", bytes("jkl"));
    await fs.rm("/free");
    await fs.writeStream("/stream", (async function* () {
      yield bytes("abc");
      await fs.rm("/stream");
      await expect(fs.writeFile("/other", bytes("x"))).rejects.toMatchObject({ code: "ENOSPC" });
      yield new Uint8Array();
    })());
    await fs.writeFile("/other", bytes("xyz"));
  });
});

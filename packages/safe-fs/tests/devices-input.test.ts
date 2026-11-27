import { expect, it, vi } from "vitest";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

for (const name of ["zero", "random", "urandom"]) {
  it(`${name} supports bounded streams, retained reads and descriptors`, async () => {
    const random = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(buffer => {
      (buffer as Uint8Array).fill(37);
      return buffer;
    });
    try {
      const fs = createDeviceFileSystem(new MemoryFileSystem());
      const path = `/dev/${name}`;
      const expected = name === "zero" ? 0 : 37;
      expect(await fs.stat(path)).toMatchObject({ type: "character", size: 0 });
      const chunks = [];
      for await (const chunk of fs.readStream(path, { start: 4, endExclusive: 11, chunkSize: 3 })) chunks.push([...chunk]);
      expect(chunks).toEqual([[expected, expected, expected], [expected, expected, expected], [expected]]);
      const handle = await fs.openReadFile(path);
      expect(await handle.read(100, 4)).toEqual(new Uint8Array(4).fill(expected));
      expect((await handle.read(0, 100000)).length).toBeLessThanOrEqual(65536);
      await handle.close();
      await expect(handle.read(0, 1)).rejects.toMatchObject({ code: "EBADF" });
      const descriptor = await fs.open(path, { access: "readwrite" });
      const buffer = new Uint8Array(4).fill(255);
      expect(await descriptor.read(buffer, null)).toBe(4);
      expect(buffer).toEqual(new Uint8Array(4).fill(expected));
      expect(await descriptor.write(new Uint8Array([1, 2]), null)).toBe(2);
      await descriptor.close();
      await expect(fs.readFile(path, { maxBytes: 10 })).rejects.toMatchObject({ code: "EFBIG" });
    } finally { random.mockRestore(); }
  });

  it(`${name} resolves aliases, rejects traversal, and preserves backing data`, async () => {
    const backing = new MemoryFileSystem();
    await backing.mkdir("/dev");
    const path = `/dev/${name}`;
    await backing.writeFile(path, new Uint8Array([91]));
    await backing.symlink(path, "/alias");
    const fs = createDeviceFileSystem(backing);
    expect(await fs.realpath("/alias")).toBe(path);
    expect(await fs.stat("/alias")).toEqual(await fs.stat(path));
    expect((await fs.stat(path)).ino).not.toBe((await fs.stat("/dev/null")).ino);
    await fs.writeFile("/alias", new Uint8Array([1]));
    expect(await backing.readFile(path)).toEqual(new Uint8Array([91]));
    await expect(fs.writeFile(path, new Uint8Array(), { flag: "wx" })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(fs.rm(path)).rejects.toMatchObject({ code: "EBUSY" });
    for (const invalid of [`${path}/`, `${path}/../escaped`, "/alias/../escaped"]) {
      await expect(fs.stat(invalid)).rejects.toMatchObject({ code: "ENOTDIR" });
    }
  });
}

it("lists all devices without duplicates and accounts for directory limits", async () => {
  const fs = createDeviceFileSystem(new MemoryFileSystem());
  const entries = ["null", "zero", "random", "urandom"].map(name => ({ name, type: "character" }));
  expect(await fs.readdir("/dev")).toEqual(entries);
  const iterated = [];
  for await (const entry of fs.iterateDirectory("/dev")) iterated.push(entry);
  expect(iterated).toEqual(entries);
  await expect(fs.readdir("/dev", { maxEntries: 3 })).rejects.toBeDefined();
});

it("infinite device reads yield to cancellation", async () => {
  const fs = createDeviceFileSystem(new MemoryFileSystem());
  const controller = new AbortController();
  const reason = new Error("stop device input");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await expect((async () => {
      for await (const chunk of fs.readStream("/dev/zero", { signal: controller.signal })) expect(chunk.length).toBeLessThanOrEqual(65536);
    })()).rejects.toBe(reason);
  } finally { clearTimeout(timer); }
});

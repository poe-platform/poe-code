import { expect, it } from "vitest";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { PythonStatTranslator } from "../src/python/stat.js";

for (const historical of [false, true]) {
  it(`provides stable complete device metadata over ${historical ? "historical" : "absent"} backing entries`, async () => {
    const backing = new MemoryFileSystem();
    if (historical) {
      await backing.mkdir("/dev");
      await backing.writeFile("/dev/null", Uint8Array.of(42));
    }
    await backing.symlink("/dev", "/devices");
    await backing.symlink("/dev/null", "/alias");
    const view = createDeviceFileSystem(backing);
    const translator = new PythonStatTranslator();
    const root = await backing.stat("/");
    const device = await view.stat("/dev/null");
    const directory = await view.stat("/dev");
    expect(device).toMatchObject({
      type: "character", mode: 0o020666, size: 0, allocatedBytes: 0,
      uid: 0, gid: 0, dev: 0, ino: 1, nlink: 1, preferredIoBlockSize: 4096,
      atimeMs: 0, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0,
    });
    expect(directory).toMatchObject({
      type: "directory", mode: 0o040755, size: 0, allocatedBytes: 0,
      uid: 0, gid: 0, dev: 0, ino: 2, nlink: 1,
      atimeMs: 0, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0,
    });
    expect(device.identityScope).toBe(directory.identityScope);
    expect(device.identityScope).not.toBe(root.identityScope);
    expect(translator.translate(device).dev).not.toBe(translator.translate(root).dev);
    expect((await createDeviceFileSystem(new MemoryFileSystem()).stat("/dev/null")).identityScope).not.toBe(device.identityScope);
    for (const path of ["/dev/null", "dev/./null", "/devices/null"]) {
      expect(await view.stat(path)).toEqual(device);
      expect(await view.lstat(path)).toEqual(device);
    }
    expect(await view.stat("/alias")).toEqual(device);
    expect(await view.lstat("/alias")).toEqual(await backing.lstat("/alias"));
    for (const path of ["/dev", "dev/.", "/devices/."]) {
      expect(await view.stat(path)).toEqual(directory);
      expect(await view.lstat(path)).toEqual(directory);
    }
    device.uid = 42;
    directory.gid = 42;
    expect(await view.stat("/dev/null")).toMatchObject({ uid: 0, gid: 0 });
    expect(await view.lstat("/dev")).toMatchObject({ uid: 0, gid: 0 });
    expect(await view.stat("/")).toEqual(root);
  });
}

for (const access of ["read", "write", "readwrite"] as const) {
  it(`retains path metadata and virtual identity for ${access} null descriptors`, async () => {
    const backing = new MemoryFileSystem();
    const view = createDeviceFileSystem(backing);
    const expected = await view.stat("/dev/null");
    const descriptor = await view.open("/dev/null", { access });
    try {
      expect(await descriptor.stat()).toMatchObject({ uid: 0, gid: 0 });
      expect(await descriptor.stat()).toEqual(expected);
      if (access !== "read") expect(await descriptor.write(Uint8Array.of(42), null)).toBe(1);
      if (access !== "write") expect(await descriptor.read(new Uint8Array(1), null)).toBe(0);
      await backing.mkdir("/dev");
      await backing.writeFile("/dev/null", Uint8Array.of(1, 2, 3));
      const observed = await descriptor.stat();
      expect(observed).toEqual(expected);
      observed.gid = 42;
      expect(await descriptor.stat()).toEqual(expected);
      expect(await view.lstat("/dev/null")).toEqual(expected);
      const translator = new PythonStatTranslator();
      expect(translator.translate(await descriptor.stat())).toEqual(translator.translate(expected));
      expect(translator.translate(expected).dev).not.toBe(translator.translate(await backing.stat("/dev/null")).dev);
    } finally {
      await descriptor.close();
    }
  });
}

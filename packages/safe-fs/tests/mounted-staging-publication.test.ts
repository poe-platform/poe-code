import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { FsError, type FileSystem } from "../src/contracts/index.js";

function view(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const owner = key in methods ? methods : target;
    const value: unknown = Reflect.get(owner, key);
    return typeof value === "function" ? value.bind(owner) : value;
  } });
}

for (const kind of ["mount", "device"] as const) for (const scoped of [false, true]) {
  for (const failed of [false, true]) test(`${kind} publication preserves ${failed ? "backend failure" : "completed acknowledgement"} after abort: scoped=${scoped}`, async () => {
    const memory = createMemoryFileSystem(); await memory.mkdir("/work");
    await memory.writeFile("/work/target", new Uint8Array([42]));
    const controller = new AbortController();
    const backing = view(memory, { publishStagedFile: async (...args) => {
      await memory.publishStagedFile(...args);
      controller.abort(false);
      if (failed) throw new FsError("EIO");
    } });
    const adapter = kind === "mount" ? createMountFileSystem({ root: backing }) : createDeviceFileSystem(backing);
    const fs = scoped ? scopeFileSystem(adapter, () => {}, controller.signal) : adapter;
    const parent = await fs.lstat("/work");
    const staging = await fs.createStagedFile!("/work/.stage", "file", {
      type: "file", data: new Uint8Array([9]),
    }, { parent, retainCleanup: true });
    try {
      const publication = fs.publishStagedFile!(staging, "/work/target", {
        parent, destination: await fs.lstat("/work/target"), signal: controller.signal,
      });
      if (failed) await assert.rejects(publication, { code: "EIO" });
      else await publication;
      assert.equal(controller.signal.aborted, true);
      assert.deepEqual(await memory.readFile("/work/target"), new Uint8Array([9]));
      await assert.rejects(memory.lstat(staging.file.path), { code: "ENOENT" });
    } finally { await staging.cleanup!.remove(); }
  });
}

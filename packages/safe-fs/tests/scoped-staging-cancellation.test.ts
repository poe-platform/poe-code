import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { FsError, type FileSystem } from "../src/contracts/index.js";

function view(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const owner = key in methods ? methods : target;
    const value: unknown = Reflect.get(owner, key);
    return typeof value === "function" ? value.bind(owner) : value;
  } });
}

for (const phase of ["creation admission", "publication admission", "publication guard"] as const) {
  for (const first of ["caller", "scope"] as const) for (const reason of [false, null, new FsError("EXDEV")] as const) {
    test(`${phase} retains the first ${first} cancellation reason: ${String(reason)}`, async () => {
      const memory = createMemoryFileSystem(); await memory.mkdir("/work");
      await memory.writeFile("/work/target", new Uint8Array([42]));
      const caller = new AbortController(), ambient = new AbortController();
      const cancel = () => {
        (first === "caller" ? caller : ambient).abort(reason);
        (first === "caller" ? ambient : caller).abort(new FsError("EIO"));
      };
      let armed = true;
      const backing = view(memory, { capabilitiesFor: async () => {
        if (armed && phase !== "publication guard") { armed = false; cancel(); }
        return memory.capabilities;
      } });
      const fs = scopeFileSystem(backing, () => {}, ambient.signal);
      const parent = await memory.lstat("/work");
      if (phase === "creation admission") {
        await assert.rejects(fs.createStagedFile!("/work/.stage", "file", {
          type: "file", data: new Uint8Array([9]),
        }, { parent, retainCleanup: true, signal: caller.signal }), error => error === reason);
        assert.deepEqual((await memory.readdir("/work")).map(entry => entry.name), ["target"]);
      } else {
        const staging = await memory.createStagedFile("/work/.stage", "file", {
          type: "file", data: new Uint8Array([9]),
        }, { parent, retainCleanup: true });
        try {
          await assert.rejects(fs.publishStagedFile!(staging, "/work/target", {
            parent, destination: await memory.lstat("/work/target"), signal: caller.signal,
            ...(phase === "publication guard" ? { commitGuard: () => { cancel(); return true as const; } } : {}),
          }), error => error === reason);
          assert.deepEqual(await memory.readFile("/work/target"), new Uint8Array([42]));
          assert.deepEqual(await memory.readFile(staging.file.path), new Uint8Array([9]));
        } finally { await staging.cleanup!.remove(); }
      }
      assert.equal(caller.signal.aborted, true);
      assert.equal(ambient.signal.aborted, true);
    });
  }
}

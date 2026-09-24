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

for (const phase of ["creation charge", "publication charge", "creation admission", "publication admission", "publication guard"] as const) {
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
        if (armed && phase.endsWith("admission")) { armed = false; cancel(); }
        return memory.capabilities;
      } });
      const fs = scopeFileSystem(backing, () => { if (phase.endsWith("charge")) cancel(); }, ambient.signal);
      const parent = await memory.lstat("/work");
      if (phase.startsWith("creation")) {
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

for (const phase of ["before", "after"] as const) for (const supplied of ["omitted", "same", "distinct"] as const) {
  test(`unguarded scoped publication cooperates with ${phase}-commit cancellation: signal=${supplied}`, async () => {
    const memory = createMemoryFileSystem(); await memory.mkdir("/work");
    await memory.writeFile("/work/target", new Uint8Array([42]));
    const ambient = new AbortController(), caller = new AbortController();
    let dispatched: AbortSignal | undefined;
    const capabilities = Object.freeze({ ...memory.capabilities, guardedStagingPublication: false });
    const backing = view(memory, {
      capabilities,
      publishStagedFile: async (...args) => {
        dispatched = args[2].signal;
        if (phase === "before") ambient.abort(false);
        await memory.publishStagedFile(...args);
        if (phase === "after") ambient.abort(false);
      },
    });
    const fs = scopeFileSystem(backing, () => {}, ambient.signal);
    const parent = await memory.lstat("/work");
    const staging = await memory.createStagedFile("/work/.stage", "file", {
      type: "file", data: new Uint8Array([9]),
    }, { parent, retainCleanup: true });
    try {
      const publication = fs.publishStagedFile!(staging, "/work/target", {
        parent, destination: await memory.lstat("/work/target"),
        ...(supplied === "omitted" ? {} : { signal: supplied === "same" ? ambient.signal : caller.signal }),
      });
      if (phase === "before") await assert.rejects(publication, error => error === false);
      else await publication;
      assert.deepEqual(await memory.readFile("/work/target"), new Uint8Array([phase === "before" ? 42 : 9]));
      assert.equal(dispatched?.aborted, true);
      assert.equal(dispatched?.reason, false);
      assert.equal(caller.signal.aborted, false);
    } finally { await staging.cleanup!.remove(); }
  });
}

test("unguarded scoped publication retains the backend failure after dispatch", async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  await memory.writeFile("/work/target", new Uint8Array([42]));
  const ambient = new AbortController(), failure = new FsError("EIO");
  const backing = view(memory, {
    capabilities: Object.freeze({ ...memory.capabilities, guardedStagingPublication: false }),
    publishStagedFile: async () => { ambient.abort(false); throw failure; },
  });
  const fs = scopeFileSystem(backing, () => {}, ambient.signal);
  const parent = await memory.lstat("/work");
  const staging = await memory.createStagedFile("/work/.stage", "file", {
    type: "file", data: new Uint8Array([9]),
  }, { parent, retainCleanup: true });
  try {
    await assert.rejects(fs.publishStagedFile!(staging, "/work/target", {
      parent, destination: await memory.lstat("/work/target"),
    }), error => error === failure);
    assert.deepEqual(await memory.readFile("/work/target"), new Uint8Array([42]));
  } finally { await staging.cleanup!.remove(); }
});

import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { FsError, type FileSystem, type FsOptions } from "../src/contracts/index.js";

function view(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const owner = key in methods ? methods : target;
    const value: unknown = Reflect.get(owner, key);
    return typeof value === "function" ? value.bind(owner) : value;
  } });
}

for (const kind of ["mount", "device"] as const) for (const retainCleanup of [false, true]) {
  for (const supplied of ["omitted", "same", "distinct"] as const) test(`scope creation aborts before ${kind} commit: retained=${retainCleanup}, signal=${supplied}`, async () => {
    const memory = createMemoryFileSystem(); await memory.mkdir("/work");
    const scopeController = new AbortController(), caller = new AbortController();
    let armed = false;
    const abort = (path: string): void => {
      if (armed && path.startsWith("/work")) { armed = false; scopeController.abort(false); }
    };
    const backing = view(memory, {
      lstat: async (path, options) => { abort(path); return memory.lstat(path, options); },
      realpath: async (path, options) => { abort(path); return memory.realpath(path, options); },
    });
    const adapter = kind === "mount" ? createMountFileSystem({ root: backing }) : createDeviceFileSystem(backing);
    const boundary = view(adapter, { createStagedFile: async (...args) => { armed = true; return adapter.createStagedFile(...args); } });
    const fs = scopeFileSystem(boundary, () => {}, scopeController.signal);
    const control: FsOptions = supplied === "omitted" ? {} : { signal: supplied === "same" ? scopeController.signal : caller.signal };
    const operation = fs.createStagedFile!("/work/.stage", "file", { type: "file", data: new Uint8Array([1]) }, {
      parent: await memory.lstat("/work"), retainCleanup, ...control,
    });
    await assert.rejects(operation, error => error === false);
    assert.equal(scopeController.signal.aborted, true);
    assert.equal(caller.signal.aborted, false);
    assert.deepEqual(await memory.readdir("/work"), []);
  });
}

for (const retainCleanup of [false, true]) for (const supplied of ["omitted", "same", "distinct"] as const) {
  test(`scope forwards cancellation and preserves completed creation: retained=${retainCleanup}, signal=${supplied}`, async () => {
    const memory = createMemoryFileSystem(); await memory.mkdir("/work");
    const scopeController = new AbortController(), caller = new AbortController();
    let dispatched: AbortSignal | undefined;
    const backing = view(memory, { createStagedFile: async (...args) => {
      dispatched = args[3].signal;
      const receipt = await memory.createStagedFile(...args);
      scopeController.abort(false);
      return receipt;
    } });
    const fs = scopeFileSystem(backing, () => {}, scopeController.signal, () => {});
    const control: FsOptions = supplied === "omitted" ? {} : { signal: supplied === "same" ? scopeController.signal : caller.signal };
    const receipt = await fs.createStagedFile!("/work/.stage", "file", { type: "file", data: new Uint8Array([1]) }, {
      parent: await memory.lstat("/work"), retainCleanup, ...control,
    });
    assert.equal(scopeController.signal.aborted, true);
    assert.equal(caller.signal.aborted, false);
    if (supplied !== "distinct") assert.equal(dispatched, scopeController.signal);
    else { assert.notEqual(dispatched, caller.signal); assert.equal(dispatched?.reason, false); }
    assert.deepEqual(await memory.readFile(receipt.file.path), new Uint8Array([1]));
    if (receipt.cleanup) await receipt.cleanup.remove(); else await memory.removeStagedFile(receipt);
  });
}

test("scope preserves a dispatched creation failure when ambient cancellation follows it", async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  const scopeController = new AbortController();
  const failure = new FsError("EIO");
  const backing = view(memory, { createStagedFile: async () => { scopeController.abort(false); throw failure; } });
  const fs = scopeFileSystem(backing, () => {}, scopeController.signal);
  await assert.rejects(fs.createStagedFile!("/work/.stage", "file", { type: "file", data: new Uint8Array([1]) }, {
    parent: await memory.lstat("/work"), retainCleanup: true,
  }), error => error === failure);
  assert.deepEqual(await memory.readdir("/work"), []);
});

for (const kind of ["mount", "device"] as const) for (const reason of [false, null, new FsError("EXDEV")] as const) {
  test(`scope creation preserves caller cancellation through ${kind}: ${String(reason)}`, async () => {
    const memory = createMemoryFileSystem(); await memory.mkdir("/work");
    const scopeController = new AbortController(), caller = new AbortController();
    let armed = false;
    const abort = (path: string): void => {
      if (armed && path.startsWith("/work")) { armed = false; caller.abort(reason); }
    };
    const backing = view(memory, {
      lstat: async (path, options) => { abort(path); return memory.lstat(path, options); },
      realpath: async (path, options) => { abort(path); return memory.realpath(path, options); },
    });
    const adapter = kind === "mount" ? createMountFileSystem({ root: backing }) : createDeviceFileSystem(backing);
    const boundary = view(adapter, { createStagedFile: async (...args) => { armed = true; return adapter.createStagedFile(...args); } });
    const fs = scopeFileSystem(boundary, () => {}, scopeController.signal);
    await assert.rejects(fs.createStagedFile!("/work/.stage", "file", { type: "file", data: new Uint8Array([1]) }, {
      parent: await memory.lstat("/work"), retainCleanup: true, signal: caller.signal,
    }), error => error === reason);
    assert.equal(scopeController.signal.aborted, false);
    assert.deepEqual(await memory.readdir("/work"), []);
  });
}

for (const kind of ["memory", "mount", "device"] as const) for (const inherited of [false, true]) {
  test(`scope captures a changing caller signal before ${kind} creation: inherited=${inherited}`, async () => {
    const memory = createMemoryFileSystem(); await memory.mkdir("/work");
    const caller = new AbortController(), ambient = new AbortController();
    const adapter = kind === "mount" ? createMountFileSystem({ root: memory })
      : kind === "device" ? createDeviceFileSystem(memory) : memory;
    const backing = view(adapter, { createStagedFile: async (...args) => {
      caller.abort(false);
      return adapter.createStagedFile(...args);
    } });
    const fs = scopeFileSystem(backing, () => {}, ambient.signal);
    let reads = 0;
    const controls = { get signal() { reads++; return reads === 1 ? caller.signal : undefined; } };
    const options = { parent: await memory.lstat("/work"), retainCleanup: true };
    if (inherited) Object.setPrototypeOf(options, controls);
    else Object.defineProperty(options, "signal", Object.getOwnPropertyDescriptor(controls, "signal")!);
    let receipt: Awaited<ReturnType<NonNullable<FileSystem["createStagedFile"]>>> | undefined;
    try {
      await assert.rejects(async () => { receipt = await fs.createStagedFile!("/work/.stage", "file", {
        type: "file", data: new Uint8Array([1]),
      }, options); }, error => error === false);
      assert.equal(reads, 1);
      assert.deepEqual(await memory.readdir("/work"), []);
    } finally { await receipt?.cleanup?.remove(); }
  });
}

test("scope captures caller controls before an admission charge changes them", async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  const caller = new AbortController();
  const options = { parent: await memory.lstat("/work"), retainCleanup: true, signal: caller.signal };
  const fs = scopeFileSystem(memory, () => { Reflect.set(options, "signal", undefined); caller.abort(null); }, new AbortController().signal);
  let receipt: Awaited<ReturnType<NonNullable<FileSystem["createStagedFile"]>>> | undefined;
  try {
    await assert.rejects(async () => { receipt = await fs.createStagedFile!("/work/.stage", "file", {
      type: "file", data: new Uint8Array([1]),
    }, options); }, error => error === null);
    assert.deepEqual(await memory.readdir("/work"), []);
  } finally { await receipt?.cleanup?.remove(); }
});

test("scope rejects an already closed creation before reading caller controls", async () => {
  const memory = createMemoryFileSystem(); await memory.mkdir("/work");
  const ambient = new AbortController(); ambient.abort(false);
  let reads = 0, charges = 0;
  const fs = scopeFileSystem(memory, () => { charges++; }, ambient.signal);
  await assert.rejects(fs.createStagedFile!("/work/.stage", "file", { type: "file", data: new Uint8Array([1]) }, {
    parent: await memory.lstat("/work"), get signal(): AbortSignal { reads++; throw new Error("must not read"); },
  }), error => error === false);
  assert.equal(reads, 0);
  assert.equal(charges, 0);
});

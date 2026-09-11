import { expect, it } from "vitest";
import type { DirectoryEntry, FileSystem } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function fixture() {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/file", Uint8Array.of(1, 2, 3));
  const entered = deferred<void>();
  const metadata = deferred<DirectoryEntry[]>();
  const filesystem = new Proxy(Object.create(memory) as FileSystem, {
    get(_target, property) {
      if (property === "readdir") return () => { entered.resolve(); return metadata.promise; };
      const value = Reflect.get(memory, property);
      return typeof value === "function" ? value.bind(memory) : value;
    },
  });
  return { memory, entered, metadata, quota: withFileSystemQuota(filesystem, { maxBytes: 64 }) };
}

it("does not retain an opened resize handle behind canceled opaque quota census metadata", async () => {
  const { memory, entered, metadata, quota } = await fixture();
  const handle = await quota.openResizeFile!("/file");
  const controller = new AbortController();
  const outcome = handle.truncate(4, { signal: controller.signal }).then(value => ({ value }), error => ({ error }));
  await entered.promise;
  controller.abort(false);
  const closing = handle.close();
  let completedBeforeMetadata = false;
  try {
    completedBeforeMetadata = await Promise.race([
      Promise.all([outcome, closing]).then(() => true),
      new Promise<false>(resolve => { setImmediate(() => resolve(false)); }),
    ]);
  } finally {
    metadata.resolve(await memory.readdir("/"));
    await closing;
  }
  expect(await outcome).toEqual({ error: false });
  expect(await memory.readFile("/file")).toEqual(Uint8Array.of(1, 2, 3));
  expect(completedBeforeMetadata).toBe(true);
});

it("cancels pre-creation quota metadata without waiting or creating a late file", async () => {
  const { memory, entered, metadata, quota } = await fixture();
  const controller = new AbortController();
  const outcome = quota.openResizeFile!("/new", { create: true, signal: controller.signal }).then(value => ({ value }), error => ({ error }));
  await entered.promise;
  controller.abort(null);
  let completedBeforeMetadata = false;
  try {
    completedBeforeMetadata = await Promise.race([
      outcome.then(() => true),
      new Promise<false>(resolve => { setImmediate(() => resolve(false)); }),
    ]);
  } finally {
    metadata.resolve(await memory.readdir("/"));
  }
  expect(await outcome).toEqual({ error: null });
  await expect(memory.stat("/new")).rejects.toMatchObject({ code: "ENOENT" });
  expect(completedBeforeMetadata).toBe(true);
});

it("does not acquire after a post-census resize-method getter cancels", async () => {
  const memory = new MemoryFileSystem();
  const controller = new AbortController();
  let censusFinished = false;
  let acquisitions = 0;
  let cancelledAcquisitions = 0;
  const filesystem = new Proxy(Object.create(memory) as FileSystem, {
    get(_target, property) {
      if (property === "readdir") return async () => { censusFinished = true; return []; };
      if (property === "openResizeFile") {
        if (censusFinished) controller.abort(false);
        return async (path: string) => {
          acquisitions++;
          if (controller.signal.aborted) cancelledAcquisitions++;
          return memory.openResizeFile(path, { create: true });
        };
      }
      const value = Reflect.get(memory, property);
      return typeof value === "function" ? value.bind(memory) : value;
    },
  });
  const quota = withFileSystemQuota(filesystem, { maxBytes: 64 });
  const outcome = await quota.openResizeFile!("/new", { create: true, signal: controller.signal })
    .then(handle => ({ handle }), error => ({ error }));
  if ("handle" in outcome) await outcome.handle.close();
  expect(cancelledAcquisitions).toBe(0);
  if (controller.signal.aborted) {
    expect(outcome).toEqual({ error: false });
    expect(acquisitions).toBe(0);
    await expect(memory.stat("/new")).rejects.toMatchObject({ code: "ENOENT" });
  } else {
    expect("handle" in outcome).toBe(true);
    expect(acquisitions).toBe(1);
    await expect(memory.stat("/new")).resolves.toMatchObject({ size: 0 });
  }
});

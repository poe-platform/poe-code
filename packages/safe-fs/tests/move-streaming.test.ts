import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { expect, it } from "vitest";
import type { CommandContext, FileStat, FileStaging } from "safe-bash-contracts";
import { stageMoveReplacement } from "../../safe-bash/src/commands/move-staging.js";

for (const failure of ["none", "read", "write", "finish", "publish", "abort"]) it(`retained move staging preserves bounded I/O and cleanup: ${failure}`, async () => {
  const controller = new AbortController();
  const fault = new Error(failure);
  const size = 1024 * 1024;
  const stat = { type: "file", size, revision: 1, dev: 1, ino: 1, identityScope: {}, mode: 0o600 } as FileStat;
  let read = 0, written = 0, closes = 0, removes = 0, published = false;
  const buffer = new Uint8Array(65536).fill(9);
  const staging = { parent: { path: "/", stat }, directory: { path: "/.stage", stat }, file: { path: "/.stage/entry", stat: { ...stat, size: 0 } },
    cleanup: { async remove() { removes++; }, async close() {} },
    writer: { async write(bytes: Uint8Array) { await Promise.resolve(); if (failure === "write") throw fault; if (failure === "abort") controller.abort(fault); expect(bytes[0]).toBe(9); written += bytes.length; }, async finish() { if (failure === "finish") throw fault; return { ...stat, revision: 2, size: written }; } },
  } as FileStaging;
  const context = { signal: controller.signal, fs: {
    async openReadFile() { return { async stat() { return stat; }, async close() { closes++; }, async read(position: number, maximum: number) {
      if (failure === "read") throw fault;
      expect(read - written).toBeLessThanOrEqual(buffer.length); expect(position).toBe(read); expect(maximum).toBeLessThanOrEqual(buffer.length);
      const length = Math.min(maximum, size - position); read += length; return buffer.subarray(0, length);
    } }; },
    async lstat() { return stat; },
    async createStagedFile(_directory: string, _name: string, content: { data: Uint8Array }) { expect(content.data.length).toBe(0); return staging; },
    async publishStagedFile(receipt: FileStaging) { if (failure === "publish") throw fault; expect(written).toBe(size); expect(receipt.file.stat.revision).toBe(2); published = true; },
  } } as unknown as CommandContext;
  const work = stageMoveReplacement(context, "/source", "/target", stat, stat,
    { target: "/target", parent: stat, ancestors: [], metadata: {} }, { async step() {} } as never);
  if (failure === "none") await work; else await expect(work).rejects.toBe(fault);
  expect(published).toBe(failure === "none"); expect(closes).toBe(1); expect(removes).toBe(1);
});

it("mounted retained staging writers seal receipts that publish through the same mount", async () => {
  const backend = createMemoryFileSystem();
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": backend } });
  const parent = await fs.stat("/data");
  expect((await fs.capabilitiesFor("/data", { stagingAncestry: true })).retainedStagingWrite).toBe(true);
  const staging = await fs.createStagedFile("/data/.stage", "file", { type: "file", data: new Uint8Array() }, { parent, retainCleanup: true });
  try {
    await staging.writer!.write(Uint8Array.of(1, 2));
    await staging.writer!.write(Uint8Array.of(3));
    const stat = await staging.writer!.finish();
    await fs.publishStagedFile({ ...staging, file: { ...staging.file, stat } }, "/data/output", { parent, destination: null });
    expect(await backend.readFile("/output")).toEqual(Uint8Array.of(1, 2, 3));
  } finally { await staging.cleanup!.remove(); await staging.cleanup!.close(); }
});

import { expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import type { FileSystem } from "../src/contracts/filesystem.js";

async function fixture() {
  const root = new MemoryFileSystem(), leaf = new MemoryFileSystem();
  const fs: FileSystem = createMountFileSystem({ root, mounts: { "/mounted": leaf } });
  await fs.mkdir("/mounted/db");
  await fs.writeFile("/mounted/db/embeddings.db", Uint8Array.of(1));
  await fs.writeFile("/mounted/db/embeddings.db-wal", Uint8Array.of(2));
  const parent = await fs.lstat("/mounted/db");
  const staged = await fs.createStagedFile!("/mounted/db/.stage", "file", { type: "file", data: Uint8Array.of(3) }, { parent });
  return { root, leaf, fs, staged, options: { parent, destination: await fs.lstat("/mounted/db/embeddings.db"), companions: [
    { path: "/mounted/db/embeddings.db-wal", expected: await fs.lstat("/mounted/db/embeddings.db-wal"), remove: true },
    { path: "/mounted/db/embeddings.db-journal", expected: null, remove: true },
  ] } };
}

it("mounted source sets publish and retire companions in one backend commit", async () => {
  const { fs, staged, options } = await fixture();
  expect(fs.publishStagedFileSet).toBeTypeOf("function");
  const result = await fs.publishStagedFileSet!(staged, "/mounted/db/embeddings.db", options);
  expect(result).toEqual(await fs.lstat("/mounted/db/embeddings.db"));
  expect(await fs.readFile("/mounted/db/embeddings.db")).toEqual(Uint8Array.of(3));
  await expect(fs.lstat("/mounted/db/embeddings.db-wal")).rejects.toMatchObject({ code: "ENOENT" });
  await fs.removeStagedFile!(staged);
});
for (const conflict of ["database", "wal", "journal"]) it(`mounted source-set ${conflict} conflicts preserve all other entries`, async () => {
  const { fs, staged, options } = await fixture();
  expect(fs.publishStagedFileSet).toBeTypeOf("function");
  const path = "/mounted/db/embeddings.db" + (conflict === "database" ? "" : "-" + conflict);
  await fs.writeFile(path, Uint8Array.of(9));
  await expect(fs.publishStagedFileSet!(staged, "/mounted/db/embeddings.db", options)).rejects.toMatchObject({ code: "EAGAIN" });
  expect(await fs.readFile("/mounted/db/embeddings.db")).toEqual(Uint8Array.of(conflict === "database" ? 9 : 1));
  expect(await fs.readFile(staged.file.path)).toEqual(Uint8Array.of(3));
});
it("mounted source sets reject cross-mount staging before publication", async () => {
  const { fs, options } = await fixture();
  expect(fs.publishStagedFileSet).toBeTypeOf("function");
  const staged = await fs.createStagedFile!("/.stage", "file", { type: "file", data: Uint8Array.of(3) }, { parent: await fs.lstat("/") });
  await expect(fs.publishStagedFileSet!(staged, "/mounted/db/embeddings.db", options)).rejects.toMatchObject({ code: "EXDEV" });
  expect(await fs.readFile("/mounted/db/embeddings.db")).toEqual(Uint8Array.of(1));
});
it("mounted source-set cancellation leaves staging and source set untouched", async () => {
  const { fs, staged, options } = await fixture();
  expect(fs.publishStagedFileSet).toBeTypeOf("function");
  const controller = new AbortController(); controller.abort(false);
  await expect(fs.publishStagedFileSet!(staged, "/mounted/db/embeddings.db", { ...options, signal: controller.signal })).rejects.toBe(false);
  expect(await fs.readFile(staged.file.path)).toEqual(Uint8Array.of(3));
});

it("mounted source sets map ancestry and reject a failed commit guard without mutation", async () => {
  for (const allowed of [false, true]) {
    const { fs, staged, options } = await fixture();
    const ancestors = await Promise.all(["/", "/mounted", "/mounted/db"].map(async path => ({ path, stat: await fs.lstat(path) })));
    const run = fs.publishStagedFileSet!(staged, "/mounted/db/embeddings.db", { ...options, ancestors, commitGuard: () => {
      if (!allowed) throw new Error("rejected guard"); return true;
    } });
    if (allowed) await run; else await expect(run).rejects.toMatchObject({ code: "EIO" });
    expect(await fs.readFile("/mounted/db/embeddings.db")).toEqual(Uint8Array.of(allowed ? 3 : 1));
  }
});
it("mounted source sets reject duplicate and nonsibling companion paths", async () => {
  for (const path of ["/mounted/db/embeddings.db", "/mounted/db/../db/embeddings.db-wal", "/other"]) {
    const { fs, staged, options } = await fixture();
    await expect(fs.publishStagedFileSet!(staged, "/mounted/db/embeddings.db", {
      ...options, companions: [...options.companions, { path, expected: null, remove: true }],
    })).rejects.toMatchObject({ code: "EINVAL" });
    expect(await fs.readFile("/mounted/db/embeddings.db")).toEqual(Uint8Array.of(1));
  }
});
it("only one mounted publication of the same acquired source versions commits", async () => {
  const { fs, staged, options } = await fixture();
  const other = await fs.createStagedFile!("/mounted/db/.other", "file", { type: "file", data: Uint8Array.of(4) }, { parent: options.parent });
  const results = await Promise.allSettled([fs.publishStagedFileSet!(staged, "/mounted/db/embeddings.db", options), fs.publishStagedFileSet!(other, "/mounted/db/embeddings.db", options)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "EAGAIN" } });
});

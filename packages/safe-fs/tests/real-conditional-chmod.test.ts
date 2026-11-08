import * as native from "node:fs/promises";
import { fs, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";
import { RealFileSystem } from "../src/fs/real/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import type { ChmodOptions, FileSystem } from "../src/contracts/filesystem.js";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, ...(await import("memfs")).fs };
});

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/dir/file": "original", "/machine/other": "other" });
  fs.chmodSync("/machine/dir/file", 0o644);
});

async function receipt(filesystem: FileSystem, path = "/dir/file"): Promise<ChmodOptions> {
  const parent = path.slice(0, path.lastIndexOf("/"));
  let prefix = "";
  const parents = ["/", ...parent.split("/").filter(Boolean).map(part => prefix += `/${part}`)];
  const ancestors = await Promise.all(parents.map(async path => ({ path, stat: await filesystem.lstat(path) })));
  return { parent: ancestors.at(-1)!.stat, expected: await filesystem.lstat(path), ancestors };
}

test("Real conditional chmod restores mode0000 in a synchronous guarded commit", async () => {
  const filesystem = new RealFileSystem("/machine");
  expect(filesystem.capabilities.conditionalChmod).toBe(true);
  fs.chmodSync("/machine/dir/file", 0);
  const options = await receipt(filesystem);
  const asynchronous = vi.spyOn(native, "chmod");
  let guarded = 0;
  try {
    await filesystem.chmod("/dir/file", 0o600, { ...options, commitGuard: () => { guarded++; return true; } });
    expect(guarded).toBe(1);
    expect(asynchronous).not.toHaveBeenCalled();
    expect(fs.statSync("/machine/dir/file").mode & 0o777).toBe(0o600);
    expect(fs.readFileSync("/machine/dir/file", "utf8")).toBe("original");
  } finally { asynchronous.mockRestore(); }
});

test("Real conditional chmod supports the virtual root directory", async () => {
  const filesystem = new RealFileSystem("/machine");
  await filesystem.chmod("/", 0o750, await receipt(filesystem, "/"));
  expect(fs.statSync("/machine").mode & 0o777).toBe(0o750);
});

test("Real conditional chmod rejects replaced targets without touching their modes", async () => {
  const filesystem = new RealFileSystem("/machine");
  const options = await receipt(filesystem);
  fs.renameSync("/machine/dir/file", "/machine/saved");
  fs.writeFileSync("/machine/dir/file", "replacement", { mode: 0o640 });
  await expect(filesystem.chmod("/dir/file", 0o700, options)).rejects.toMatchObject({ code: "EAGAIN", path: "/dir/file" });
  expect(fs.statSync("/machine/dir/file").mode & 0o777).toBe(0o640);
  expect(fs.statSync("/machine/saved").mode & 0o777).toBe(0o644);
});

test("Real conditional chmod rejects stale ancestry even with a current target receipt", async () => {
  const filesystem = new RealFileSystem("/machine");
  const options = await receipt(filesystem);
  fs.renameSync("/machine/dir", "/machine/old");
  fs.mkdirSync("/machine/dir");
  fs.linkSync("/machine/old/file", "/machine/dir/file");
  await expect(filesystem.chmod("/dir/file", 0o700, { ...options, expected: await filesystem.lstat("/dir/file") }))
    .rejects.toMatchObject({ code: "EAGAIN" });
  expect(fs.statSync("/machine/dir/file").mode & 0o777).toBe(0o644);
});

for (const result of [false, undefined, Promise.resolve(true)]) test(`Real conditional chmod refuses non-synchronous guard success ${String(result)}`, async () => {
  const filesystem = new RealFileSystem("/machine");
  await expect(filesystem.chmod("/dir/file", 0o700, {
    ...await receipt(filesystem), commitGuard: (() => result) as unknown as () => true,
  })).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(fs.statSync("/machine/dir/file").mode & 0o777).toBe(0o644);
});

for (const reason of [false, 0, "", null]) test(`Real conditional chmod preserves guard cancellation ${String(reason)}`, async () => {
  const filesystem = new RealFileSystem("/machine");
  const controller = new AbortController();
  await expect(filesystem.chmod("/dir/file", 0o700, {
    ...await receipt(filesystem), signal: controller.signal,
    commitGuard: () => { controller.abort(reason); return true; },
  })).rejects.toBe(reason);
  expect(fs.statSync("/machine/dir/file").mode & 0o777).toBe(0o644);
});

test("Real conditional chmod rechecks target identity after its guard", async () => {
  const filesystem = new RealFileSystem("/machine");
  await expect(filesystem.chmod("/dir/file", 0o700, {
    ...await receipt(filesystem), commitGuard: () => {
      fs.renameSync("/machine/dir/file", "/machine/saved");
      fs.symlinkSync("../other", "/machine/dir/file");
      return true;
    },
  })).rejects.toMatchObject({ code: "EAGAIN" });
  expect(fs.statSync("/machine/saved").mode & 0o777).toBe(0o644);
  expect(fs.statSync("/machine/other").mode & 0o777).not.toBe(0o700);
});

test("Real directory ancestry guards remain synchronous and reject replaced ancestors", async () => {
  const filesystem = new RealFileSystem("/machine");
  expect(filesystem.capabilities.conditionalChmod).toBe(true);
  expect(filesystem.capabilities.synchronousDirectoryValidation).not.toBe(true);
  const options = await receipt(filesystem);
  const guard = await filesystem.prepareDirectoryAncestry(options.ancestors!);
  expect(guard()).toBe(true);
  fs.renameSync("/machine/dir", "/machine/old");
  fs.mkdirSync("/machine/dir");
  expect(guard).toThrow(expect.objectContaining({ code: "EAGAIN" }));
});

test("Real directory ancestry guards retain the admitted signal", async () => {
  const filesystem = new RealFileSystem("/machine");
  const controller = new AbortController();
  const controls = { signal: controller.signal };
  const guard = await filesystem.prepareDirectoryAncestry((await receipt(filesystem)).ancestors!, controls);
  controls.signal = new AbortController().signal;
  controller.abort(0);
  await expect(Promise.resolve().then(guard)).rejects.toBe(0);
});

for (const mounted of [false, true]) test(`conditional chmod preserves Real ${mounted ? "mounted target" : "root mount"} workflows`, async () => {
  const real = new RealFileSystem("/machine");
  const filesystem = mounted
    ? new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/mounted": real } })
    : new MountFileSystem({ root: real });
  const path = mounted ? "/mounted/dir/file" : "/dir/file";
  expect((await filesystem.capabilitiesFor(path, { conditionalChmod: true })).conditionalChmod).toBe(true);
  await filesystem.chmod(path, 0o600, await receipt(filesystem, path));
  expect(fs.statSync("/machine/dir/file").mode & 0o777).toBe(0o600);
});

test("Real outer ancestry supports conditional chmod without upgrading memory staging", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  await memory.writeFile("/work/file", Uint8Array.of(1));
  const filesystem = new MountFileSystem({ root: new RealFileSystem("/machine"), mounts: { "/memory": memory } });
  const path = "/memory/work/file";
  expect((await filesystem.capabilitiesFor(path, { conditionalChmod: true })).conditionalChmod).toBe(true);
  expect((await filesystem.capabilitiesFor("/memory/work", { stagingAncestry: true })).synchronousDirectoryValidation).toBe(false);
  await filesystem.chmod(path, 0o600, await receipt(filesystem, path));
  expect((await memory.stat("/work/file")).mode & 0o777).toBe(0o600);
});

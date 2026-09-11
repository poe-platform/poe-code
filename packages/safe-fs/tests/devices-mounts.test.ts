import { expect, it, vi } from "vitest";
import { FsError } from "../src/contracts/errors.js";
import type { FileSystem } from "../src/contracts/filesystem.js";
import { toByteSource } from "../src/contracts/io.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { compareEntries } from "../src/fs/mount/comparison.js";
import { createReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { Shell } from "../../safe-bash/src/shell/index.js";

vi.mock("poe-code/safe-fs/core", () => import("../src/core.js"));

const bytes = (value: string) => new TextEncoder().encode(value);

async function fixture(historical = true) {
  const root = new MemoryFileSystem();
  if (historical) {
    await root.mkdir("/dev");
    await root.writeFile("/dev/null", bytes("historical"));
  }
  await root.writeFile("/ordinary", bytes("ordinary"));
  await root.symlink("/dev/null", "/alias");
  await root.symlink("dev/null", "/relative");
  await root.symlink("/dev", "/devices");
  const other = new MemoryFileSystem();
  await other.writeFile("/ordinary", bytes("readonly"));
  const mounted = createMountFileSystem({ root, mounts: { "/other": createReadOnlyFileSystem(other) } });
  const mutations = ["writeFile", "writeStream", "appendFile", "copyFile", "rm", "rmdir", "rename", "mkdir", "symlink", "link", "chmod", "utimes", "truncate"] as const;
  const spies = mutations.map(method => vi.spyOn(root, method));
  return { root, mounted, untouched() { for (const spy of spies) expect(spy).not.toHaveBeenCalled(); } };
}

it("masks aliases in a mixed mount whose global symlink creation capability is unknown", async () => {
  const { root, mounted, untouched } = await fixture();
  expect(mounted.capabilities.symlinks).toBeUndefined();
  expect((await mounted.capabilitiesFor("/alias")).symlinks).toBe(true);
  const view = createDeviceFileSystem(mounted);
  for (const path of ["/alias", "/relative", "/devices/null"]) {
    expect(await view.readFile(path)).toEqual(new Uint8Array());
    expect(await view.readStream(path)[Symbol.asyncIterator]().next()).toMatchObject({ done: true });
    const handle = await view.openReadFile(path);
    expect(await handle.read(0, 65536)).toEqual(new Uint8Array());
    expect(await handle.stat()).toMatchObject({ type: "character", size: 0 });
    await handle.close();
    expect(await view.capabilitiesFor(path)).toMatchObject({ readOnly: false, streamingWrite: true });
    expect(await compareEntries(view, path, view, "/dev/null")).toBe("same");
  }
  untouched();
  expect(await root.readFile("/dev/null")).toEqual(bytes("historical"));
});

for (const quota of [false, true]) it(`discards alias writes and copies without historical-row mutations, quota=${quota}`, async () => {
  const { root, mounted, untouched } = await fixture();
  const view = createDeviceFileSystem(quota ? withFileSystemQuota(mounted, { maxBytes: 0 }) : mounted);
  for (const path of ["/alias", "/relative", "/devices/null"]) {
    await view.writeFile(path, bytes("must-discard"));
    await view.appendFile(path, bytes("must-discard"));
    await view.writeStream(path, toByteSource("must-discard"));
    await view.copyFile("/ordinary", path);
    for (const flag of ["wx", "ax"] as const) await expect(view.writeFile(path, bytes("x"), { flag })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(view.copyFile("/ordinary", path, { exclusive: true })).rejects.toMatchObject({ code: "EEXIST" });
  }
  untouched();
  expect(await root.readFile("/dev/null")).toEqual(bytes("historical"));
});

for (const historical of [false, true]) it(`resolves readonly existing aliases with symlink creation disabled, historical=${historical}`, async () => {
  const { root, mounted, untouched } = await fixture(historical);
  const readonly = createReadOnlyFileSystem(mounted);
  expect(readonly.capabilities.symlinks).toBe(false);
  const view = createDeviceFileSystem(readonly);
  for (const path of ["/alias", "/relative", "/devices/null"]) {
    expect(await view.readFile(path)).toEqual(new Uint8Array());
    await view.writeFile(path, bytes("discard"));
    await view.writeStream(path, toByteSource("discard"));
  }
  await expect(view.writeFile("/ordinary", bytes("forbidden"))).rejects.toMatchObject({ code: "EROFS" });
  expect((await view.capabilitiesFor("/ordinary")).readOnly).toBe(true);
  untouched();
  if (historical) expect(await root.readFile("/dev/null")).toEqual(bytes("historical"));
  else await expect(root.stat("/dev")).rejects.toMatchObject({ code: "ENOENT" });
});

it("preserves ordinary routing and final symlink entry mutations in a mixed mount", async () => {
  const { root, mounted } = await fixture();
  const view = createDeviceFileSystem(mounted);
  expect(await view.readFile("/ordinary")).toEqual(bytes("ordinary"));
  expect(await compareEntries(view, "/ordinary", mounted, "/ordinary")).toBe("same");
  await view.writeFile("/ordinary", bytes("changed"));
  await expect(view.writeFile("/other/ordinary", bytes("forbidden"))).rejects.toMatchObject({ code: "EROFS" });
  expect(await view.lstat("/alias")).toMatchObject({ type: "symlink" });
  expect(await view.readlink("/alias")).toBe("/dev/null");
  await view.rename("/alias", "/moved");
  expect(await view.readFile("/moved")).toEqual(new Uint8Array());
  await view.rm("/moved");
  await expect(root.lstat("/moved")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(view.rm("/devices/null")).rejects.toMatchObject({ code: "EBUSY" });
  await expect(view.writeFile("/devices/null/../ordinary", bytes("forbidden"))).rejects.toMatchObject({ code: "ENOTDIR" });
  expect(await root.readFile("/ordinary")).toEqual(bytes("changed"));
  expect(await root.readFile("/dev/null")).toEqual(bytes("historical"));
});

for (const failure of ["absent", "unsupported", "missing"] as const) it(`fails closed for a discovered symlink with ${failure} readlink`, async () => {
  const readFile = vi.fn(async () => bytes("historical"));
  const writeFile = vi.fn(async () => {});
  const backing = { capabilities: { symlinks: false }, readFile, writeFile,
    async lstat() { return { type: "symlink", size: 9, mode: 0o777, mtimeMs: 0 }; },
    ...(failure === "absent" ? {} : { async readlink() { throw new FsError(failure === "unsupported" ? "ENOTSUP" : "ENOENT"); } }),
  } as unknown as FileSystem;
  const view = createDeviceFileSystem(backing);
  const code = failure === "missing" ? "ENOENT" : "ENOTSUP";
  await expect(view.readFile("/alias")).rejects.toMatchObject({ code });
  await expect(view.writeFile("/alias", bytes("discard"))).rejects.toMatchObject({ code });
  expect(readFile).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
});

it("does not fall back to ordinary delegation when metadata becomes unsupported after a discovered alias", async () => {
  const readFile = vi.fn(async () => bytes("historical"));
  const writeFile = vi.fn(async () => {});
  const backing = { capabilities: {}, readFile, writeFile,
    async lstat(path: string) {
      if (path === "/alias") return { type: "symlink", size: 7, mode: 0o777, mtimeMs: 0 };
      throw new FsError("ENOTSUP");
    },
    async readlink() { return "/opaque"; },
  } as unknown as FileSystem;
  const view = createDeviceFileSystem(backing);
  await expect(view.readFile("/alias")).rejects.toMatchObject({ code: "ENOTSUP" });
  await expect(view.writeFile("/alias", bytes("discard"))).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(readFile).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
});

it("protects mixed-mount aliases at the actual Shell filesystem boundary", async () => {
  const { root, mounted, untouched } = await fixture();
  const shell = new Shell({ fs: mounted });
  shell.register({ name: "probe", async execute({ fs, stdout }) {
    await stdout.write(await fs.readFile("/alias"));
    await fs.writeFile("/alias", bytes("must-discard"));
    return { exitCode: 0 };
  } });
  shell.register({ name: "emit", async execute({ stdout }) { await stdout.write(bytes("must-discard")); return { exitCode: 0 }; } });
  try {
    const result = await shell.exec("probe; emit >> /alias");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    untouched();
    expect(await root.readFile("/dev/null")).toEqual(bytes("historical"));
  } finally { await shell.dispose(); }
});

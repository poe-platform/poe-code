import { vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";
import { RealFileSystem } from "../src/fs/real/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import type { FileSystem } from "../src/contracts/index.js";
import { Shell } from "../../safe-bash/src/index.js";
import { diffPatchCommands } from "../../safe-bash/src/commands/diff-patch/index.js";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, ...(await import("memfs")).fs };
});
const bytes = (text: string) => new TextEncoder().encode(text);
const change = "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n";
beforeEach(() => { vi.restoreAllMocks(); vol.reset(); vol.mkdirSync("/machine", { recursive: true }); });
async function fixture(mounted: boolean, retained = true) {
  const backend = retained ? new MemoryFileSystem() : new RealFileSystem("/machine");
  if (retained) {
    // Model an isolated trusted host while retaining the backend's real staging leases.
    Object.defineProperty(backend, "capabilities", { configurable: true, value: {
      ...backend.capabilities, atomicStagingAncestry: false, trustedOwnedStaging: true,
    } });
  }
  const fs: FileSystem = mounted ? new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/work": backend } }) : backend;
  await fs.mkdir("/work", { recursive: true });
  await fs.writeFile("/work/target", bytes("old\n"));
  await fs.chmod!("/work/target", 0o751);
  await fs.writeFile("/work/new", bytes("new\n"));
  await fs.writeFile("/work/change", bytes(change));
  const shell = new Shell({ fs }).use(diffPatchCommands());
  return { fs, backend, shell, root: mounted ? "" : "/work" };
}
for (const mounted of [false, true]) {
  for (const piped of [false, true]) test(`${mounted ? "mounted" : "direct"} trusted patch ${piped ? "pipeline" : "input"} preserves mode and reverses`, async () => {
    const { fs, shell } = await fixture(mounted);
    try {
      const result = await shell.exec(piped ? "diff -u --label target --label target target new | patch" : "patch -i change", { cwd: "/work" });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(await fs.readFile("/work/target")).toEqual(bytes("new\n"));
      expect((await fs.lstat("/work/target")).mode & 0o777).toBe(0o751);
      const reversed = await shell.exec("patch -R -i change", { cwd: "/work" });
      expect(reversed.exitCode, reversed.stderr).toBe(0);
      expect(await fs.readFile("/work/target")).toEqual(bytes("old\n"));
      expect((await fs.readdir("/work")).map(entry => entry.name).sort()).toEqual(["change", "new", "target"]);
      expect(fs.capabilities.atomicStagingAncestry).not.toBe(true);
      const capabilities = await fs.capabilitiesFor?.("/work") ?? fs.capabilities;
      expect(capabilities.retainedStagingCleanup).toBe(true);
      expect(capabilities.retainedStagingWrite).toBe(true);
    } finally { await shell.dispose(); }
  });
  test(`${mounted ? "mounted" : "direct"} trusted patch creates nested paths and deletes them on reverse`, async () => {
    const { fs, shell } = await fixture(mounted);
    await fs.writeFile("/work/change", bytes("--- /dev/null\n+++ tree/child\n@@ -0,0 +1 @@\n+created\n"));
    try {
      const created = await shell.exec("patch -p0 -i change", { cwd: "/work" });
      expect(created.exitCode, created.stderr).toBe(0);
      expect(await fs.readFile("/work/tree/child")).toEqual(bytes("created\n"));
      const removed = await shell.exec("patch -p0 -R -i change", { cwd: "/work" });
      expect(removed.exitCode, removed.stderr).toBe(0);
      await expect(fs.lstat("/work/tree/child")).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await shell.dispose(); }
  });
}
for (const conflict of ["target", "ancestor", "failure", "cancel"] as const) test(`trusted patch handles ${conflict} before publication`, async () => {
  const { fs, backend, shell, root } = await fixture(false);
  const original = backend.createStagedFile.bind(backend);
  const controller = new AbortController();
  vi.spyOn(backend, "createStagedFile").mockImplementation(async (...args) => {
    const staged = await original(...args);
    if (conflict === "target") await backend.writeFile(`${root}/target`, bytes("foreign\n"));
    if (conflict === "ancestor") {
      await backend.rename(root, `${root}-saved`);
      await backend.mkdir(root);
      await backend.writeFile(`${root}/target`, bytes("foreign\n"));
    }
    if (conflict === "cancel") controller.abort(new Error("cancelled"));
    return staged;
  });
  if (conflict === "failure") vi.spyOn(backend, "publishStagedFile").mockRejectedValue(new Error("publication failed"));
  try {
    const result = await shell.exec("patch -i change", { cwd: "/work", signal: controller.signal }).catch(error => error);
    expect(backend.createStagedFile).toHaveBeenCalled();
    expect(result.exitCode).not.toBe(0);
    expect(await fs.readFile("/work/target")).toEqual(bytes(conflict === "target" || conflict === "ancestor" ? "foreign\n" : "old\n"));
    if (conflict !== "ancestor") expect((await fs.readdir("/work")).some(entry => entry.name.startsWith(".patch-"))).toBe(false);
    else expect(await backend.readFile(`${root}-saved/target`)).toEqual(bytes("old\n"));
  } finally { await shell.dispose(); }
});

test("trusted patch preserves UTF-8 bytes and missing final newlines", async () => {
  const { fs, shell } = await fixture(false);
  await fs.writeFile("/work/target", bytes("old☃"));
  await fs.writeFile("/work/change", bytes("--- target\n+++ target\n@@ -1 +1 @@\n-old☃\n\\ No newline at end of file\n+new★\n\\ No newline at end of file\n"));
  try {
    const result = await shell.exec("patch -i change", { cwd: "/work" });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(await fs.readFile("/work/target")).toEqual(bytes("new★"));
  } finally { await shell.dispose(); }
});

test("trusted patch preserves the published prefix when a later file fails", async () => {
  const { fs, backend, shell } = await fixture(false);
  await fs.writeFile("/work/second", bytes("old\n"));
  await fs.writeFile("/work/change", bytes(change + "--- second\n+++ second\n@@ -1 +1 @@\n-old\n+new\n"));
  const publish = backend.publishStagedFile.bind(backend);
  vi.spyOn(backend, "publishStagedFile").mockImplementation(async (stage, path, options) => {
    if (path === "/work/second") throw new Error("second publication failed");
    await publish(stage, path, options);
  });
  try {
    const result = await shell.exec("patch -i change", { cwd: "/work" });
    expect(result.exitCode).not.toBe(0);
    expect(await fs.readFile("/work/target")).toEqual(bytes("new\n"));
    expect(await fs.readFile("/work/second")).toEqual(bytes("old\n"));
    expect((await fs.readdir("/work")).some(entry => entry.name.startsWith(".patch-"))).toBe(false);
  } finally { await shell.dispose(); }
});

for (const operation of ["create", "delete"] as const) test(`trusted patch refuses a competing ${operation} entry`, async () => {
  const { fs, backend, shell, root } = await fixture(false);
  await fs.writeFile("/work/change", bytes(operation === "create"
    ? "--- /dev/null\n+++ added\n@@ -0,0 +1 @@\n+new\n"
    : "--- target\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n"));
  if (operation === "create") {
    const create = backend.createStagedFile.bind(backend);
    vi.spyOn(backend, "createStagedFile").mockImplementation(async (...args) => {
      const stage = await create(...args);
      await backend.writeFile(`${root}/added`, bytes("foreign\n"));
      return stage;
    });
  } else {
    const remove = backend.removeFileConditional.bind(backend);
    vi.spyOn(backend, "removeFileConditional").mockImplementation(async (...args) => {
      await backend.writeFile(`${root}/target`, bytes("foreign\n"));
      await remove(...args);
    });
  }
  try {
    const result = await shell.exec("patch -i change", { cwd: "/work" });
    expect(result.exitCode).not.toBe(0);
    expect(await fs.readFile(`/work/${operation === "create" ? "added" : "target"}`)).toEqual(bytes("foreign\n"));
    expect((await fs.readdir("/work")).some(entry => entry.name.startsWith(".patch-"))).toBe(false);
  } finally { await shell.dispose(); }
});

test("patch still refuses a host without either publication contract", async () => {
  const { backend, shell } = await fixture(false);
  await shell.dispose();
  Object.defineProperty(backend, "capabilities", { value: { ...backend.capabilities, trustedOwnedStaging: false } });
  const unsupported = new Shell({ fs: backend }).use(diffPatchCommands());
  try {
    const result = await unsupported.exec("patch -i change", { cwd: "/work" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("filesystem does not support race-safe patch publication");
    expect(await backend.readFile("/work/target")).toEqual(bytes("old\n"));
  } finally { await unsupported.dispose(); }
});

for (const mounted of [false, true]) for (const piped of [false, true]) {
  test(`${mounted ? "mounted" : "direct"} Real patch ${piped ? "pipeline" : "input"} publishes bounded trusted staging`, async () => {
    const { fs, backend, shell } = await fixture(mounted, false);
    const revised = "n".repeat(16384) + "★\n";
    await fs.writeFile("/work/new", bytes(revised));
    await fs.writeFile("/work/change", bytes(`--- target\n+++ target\n@@ -1 +1 @@\n-old\n+${revised}`));
    const create = vi.spyOn(backend, "createStagedFile");
    const write = vi.spyOn(backend, "writeFileConditional");
    const publish = vi.spyOn(backend, "publishStagedFile");
    const remove = vi.spyOn(backend, "removeStagedFile");
    try {
      const capabilities = await fs.capabilitiesFor?.("/work") ?? fs.capabilities;
      expect(capabilities.trustedOwnedStaging).toBe(true);
      expect(capabilities.atomicStagingAncestry).not.toBe(true);
      expect(capabilities.retainedStagingCleanup).not.toBe(true);
      expect(capabilities.retainedStagingWrite).not.toBe(true);
      const result = await shell.exec(piped ? "diff -u --label target --label target target new | patch" : "patch -i change", { cwd: "/work" });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(create).toHaveBeenCalledOnce();
      expect(create.mock.calls[0]![2]).toEqual({ type: "file", data: new Uint8Array() });
      expect(create.mock.calls[0]![3].retainCleanup).not.toBe(true);
      expect(write.mock.calls.length).toBeGreaterThan(1);
      for (const [, chunk, options] of write.mock.calls) {
        expect(chunk.byteLength).toBeLessThanOrEqual(16384);
        expect(options.append).toBe(true);
        expect(options.mode).toBe(0o751);
        expect(options.expected).toMatchObject({ type: "file" });
      }
      expect(publish).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
      expect(await fs.readFile("/work/target")).toEqual(bytes(revised));
      expect((await fs.lstat("/work/target")).mode & 0o777).toBe(0o751);
      expect((await fs.readdir("/work")).map(entry => entry.name).sort()).toEqual(["change", "new", "target"]);
    } finally { await shell.dispose(); }
  });
}


test("trusted patch refuses invalid UTF-8 without changing original bytes", async () => {
  const { fs, shell } = await fixture(false);
  const original = new Uint8Array([111, 108, 100, 255, 10]);
  await fs.writeFile("/work/target", original);
  try {
    const result = await shell.exec("patch -i change", { cwd: "/work" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid UTF-8");
    expect(await fs.readFile("/work/target")).toEqual(original);
  } finally { await shell.dispose(); }
});

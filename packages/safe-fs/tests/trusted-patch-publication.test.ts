import { fs as native, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";
import { RealFileSystem } from "../src/fs/real/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
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
async function fixture(mounted: boolean) {
  const real = new RealFileSystem("/machine");
  const fs = mounted ? new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/work": real } }) : real;
  await fs.mkdir("/work", { recursive: true });
  await fs.writeFile("/work/target", bytes("old\n"));
  await fs.chmod!("/work/target", 0o751);
  await fs.writeFile("/work/new", bytes("new\n"));
  await fs.writeFile("/work/change", bytes(change));
  const shell = new Shell({ fs }).use(diffPatchCommands());
  return { fs, real, shell, root: mounted ? "/machine" : "/machine/work" };
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
  const { fs, real, shell, root } = await fixture(false);
  const original = real.createStagedFile.bind(real);
  const controller = new AbortController();
  vi.spyOn(real, "createStagedFile").mockImplementation(async (...args) => {
    const staged = await original(...args);
    if (conflict === "target") native.writeFileSync(`${root}/target`, "foreign\n");
    if (conflict === "ancestor") {
      native.renameSync(root, `${root}-saved`);
      native.mkdirSync(root);
      native.writeFileSync(`${root}/target`, "foreign\n");
    }
    if (conflict === "cancel") controller.abort(new Error("cancelled"));
    return staged;
  });
  if (conflict === "failure") vi.spyOn(real, "publishStagedFile").mockRejectedValue(new Error("publication failed"));
  try {
    const result = await shell.exec("patch -i change", { cwd: "/work", signal: controller.signal }).catch(error => error);
    expect(real.createStagedFile).toHaveBeenCalled();
    expect(result.exitCode).not.toBe(0);
    expect(await fs.readFile("/work/target")).toEqual(bytes(conflict === "target" || conflict === "ancestor" ? "foreign\n" : "old\n"));
    if (conflict !== "ancestor") expect((await fs.readdir("/work")).some(entry => entry.name.startsWith(".patch-"))).toBe(false);
    else expect(native.readFileSync(`${root}-saved/target`, "utf8")).toBe("old\n");
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
  const { fs, real, shell } = await fixture(false);
  await fs.writeFile("/work/second", bytes("old\n"));
  await fs.writeFile("/work/change", bytes(change + "--- second\n+++ second\n@@ -1 +1 @@\n-old\n+new\n"));
  const publish = real.publishStagedFile.bind(real);
  vi.spyOn(real, "publishStagedFile").mockImplementation(async (stage, path, options) => {
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
  const { fs, real, shell, root } = await fixture(false);
  await fs.writeFile("/work/change", bytes(operation === "create"
    ? "--- /dev/null\n+++ added\n@@ -0,0 +1 @@\n+new\n"
    : "--- target\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n"));
  if (operation === "create") {
    const create = real.createStagedFile.bind(real);
    vi.spyOn(real, "createStagedFile").mockImplementation(async (...args) => {
      const stage = await create(...args);
      native.writeFileSync(`${root}/added`, "foreign\n");
      return stage;
    });
  } else {
    const remove = real.removeFileConditional.bind(real);
    vi.spyOn(real, "removeFileConditional").mockImplementation(async (...args) => {
      native.writeFileSync(`${root}/target`, "foreign\n");
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
  const { real, shell } = await fixture(false);
  await shell.dispose();
  Object.defineProperty(real, "capabilities", { value: { ...real.capabilities, trustedOwnedStaging: false } });
  const unsupported = new Shell({ fs: real }).use(diffPatchCommands());
  try {
    const result = await unsupported.exec("patch -i change", { cwd: "/work" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("filesystem does not support race-safe patch publication");
    expect(await real.readFile("/work/target")).toEqual(bytes("old\n"));
  } finally { await unsupported.dispose(); }
});


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

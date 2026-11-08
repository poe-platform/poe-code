import { vol } from "memfs";
import { beforeEach, expect, it, vi } from "vitest";
import { createWorkspaceFileSystem, runSafeBashCli } from "../../../src/cli/safe-bash-main.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { RealFileSystem } from "../src/fs/real/index.js";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:fs", async () => { const { fs } = await import("memfs"); return { ...fs, default: fs }; });
beforeEach(() => { vol.reset(); vol.fromJSON({ "/host/out/existing": "old" }); });

it("publishes with full ancestry receipts on the trusted host without claiming atomic staging", async () => {
  const fs = new RealFileSystem({ root: "/host" });
  expect(fs.capabilities.atomicFileStaging).not.toBe(true);
  const view = await fs.confineTrustedExtraction(["/out"]);
  const ancestors = await Promise.all(["/", "/out"].map(async path => ({ path, stat: await view.lstat(path) })));
  const parent = ancestors[1]!.stat;
  const staging = await view.createStagedFile!("/out/.stage", "entry", { type: "file", data: new TextEncoder().encode("new") }, { parent });
  await view.publishStagedFile!(staging, "/out/new", { parent, destination: null, ancestors });
  await view.removeStagedFile!(staging);
  expect(vol.readFileSync("/host/out/new", "utf8")).toBe("new");
  expect(vol.readdirSync("/host/out")).toEqual(["existing", "new"]);
});

for (const trusted of [false, true]) it(`preserves ancestry observation for confined memory mounts (trusted=${trusted})`, async () => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/out");
  const mounted = new MountFileSystem({ root: backing });
  const view = await (trusted ? mounted.confineTrustedExtraction(["/out"]) : mounted.confineExtraction(["/out"]));
  const ancestors = await Promise.all(["/", "/out"].map(async path => ({ path, stat: await view.lstat(path) })));
  const parent = ancestors[1]!.stat;
  const bytes = new TextEncoder().encode("confined payload");
  const stage = await view.createStagedFile!("/out/.stage", "entry", { type: "file", data: bytes }, { parent });
  await view.publishStagedFile!(stage, "/out/new", { parent, destination: null, ancestors });
  await view.removeStagedFile!(stage);
  expect(await backing.readFile("/out/new")).toEqual(bytes);
  expect((await backing.readdir("/out")).map(entry => entry.name)).toEqual(["new"]);
  await expect(view.writeFile("/outside", bytes)).rejects.toMatchObject({ code: "EPERM" });
  await expect(backing.lstat("/outside")).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects a replaced extraction root before creating directories or publishing", async () => {
  const fs = new RealFileSystem({ root: "/host" });
  const view = await fs.confineTrustedExtraction(["/out"]);
  const parent = await view.lstat("/out");
  vol.renameSync("/host/out", "/host/original");
  vol.mkdirSync("/host/out");
  await expect(view.prepareDirectory!("/out/new", { parent, expected: null })).rejects.toMatchObject({ code: "EAGAIN" });
  expect(vol.readdirSync("/host/out")).toEqual([]);
});

it("extracts npm-shaped archives through the CLI workspace mount", async () => {
  vol.fromJSON({ "/host/source/package/package.json": '{"name":"fixture"}', "/host/source/package/index.js": "export default 42;" });
  const options = { workspaceRoot: "/host", cwd: "/host", homeDir: "/home", stdout: () => {}, stderr: (bytes: Uint8Array) => { errors += new TextDecoder().decode(bytes); } };
  let errors = "";
  expect(await runSafeBashCli(["-c", "tar -czf archive.tgz -C source package"], options), errors).toBe(0);
  expect(await runSafeBashCli(["-c", "tar -xzf archive.tgz -C out"], options), errors).toBe(0);
  expect(vol.readFileSync("/host/out/package/index.js", "utf8")).toBe("export default 42;");
  const { fs } = await createWorkspaceFileSystem(options);
  expect((await fs.capabilitiesFor!("/host/out/new", { create: true, stagingAncestry: true })).atomicFileStaging).not.toBe(true);
});

it("cleans an owned stage after publication refuses a changed destination", async () => {
  const fs = new RealFileSystem("/host");
  const view = await fs.confineTrustedExtraction(["/out"]);
  const ancestors = await Promise.all(["/", "/out"].map(async path => ({ path, stat: await view.lstat(path) })));
  const parent = ancestors[1]!.stat;
  const stage = await view.createStagedFile!("/out/.stage", "entry", { type: "file", data: new Uint8Array([1]) }, { parent });
  vol.writeFileSync("/host/out/new", "foreign");
  await expect(view.publishStagedFile!(stage, "/out/new", { parent, destination: null, ancestors })).rejects.toMatchObject({ code: "EAGAIN" });
  await view.removeStagedFile!(stage);
  expect(vol.readdirSync("/host/out")).toEqual(["existing", "new"]);
  expect(vol.readFileSync("/host/out/new", "utf8")).toBe("foreign");
});

for (const replacement of ["directory", "symlink"] as const) it(`rejects ${replacement} ancestor replacement at publication without touching the replacement`, async () => {
  const fs = new RealFileSystem("/host");
  vol.mkdirSync("/host/out/nested");
  vol.mkdirSync("/host/elsewhere");
  const view = await fs.confineTrustedExtraction(["/out"]);
  const ancestors = await Promise.all(["/", "/out", "/out/nested"].map(async path => ({ path, stat: await view.lstat(path) })));
  const parent = ancestors[2]!.stat;
  const stage = await view.createStagedFile!("/out/nested/.stage", "entry", { type: "file", data: new Uint8Array([1]) }, { parent });
  vol.renameSync("/host/out", "/host/original");
  if (replacement === "directory") vol.mkdirSync("/host/out");
  else vol.symlinkSync("/host/elsewhere", "/host/out");
  await expect(view.publishStagedFile!(stage, "/out/nested/new", { parent, destination: null, ancestors })).rejects.toBeDefined();
  expect(vol.readdirSync("/host/elsewhere")).toEqual([]);
  expect(vol.readdirSync("/host/out")).toEqual([]);
});

it("does not expose unrestricted mutations from a trusted extraction view", async () => {
  const view = await new RealFileSystem("/host").confineTrustedExtraction(["/out"]);
  await expect(async () => view.writeFile("/outside", new Uint8Array([1]))).rejects.toMatchObject({ code: "ENOTSUP" });
  const parent = await view.lstat("/");
  await expect(view.prepareDirectory!("/outside", { parent, expected: null })).rejects.toMatchObject({ code: "EPERM" });
});

for (const trusted of [false, true]) it(`retains ancestors above a mounted extraction root (${trusted ? "host" : "memory"})`, async () => {
  const root = new MemoryFileSystem();
  await root.mkdir("/outer");
  const backend = trusted ? new RealFileSystem("/host") : new MemoryFileSystem();
  const mounted = new MountFileSystem({ root, mounts: { "/outer/mount": backend } });
  const view = await (trusted ? mounted.confineTrustedExtraction(["/outer/mount"]) : mounted.confineExtraction(["/outer/mount"]));
  const parent = await view.lstat("/outer/mount");
  await root.rename("/outer", "/original");
  await root.mkdir("/outer");
  await expect(view.prepareDirectory!("/outer/mount/new", { parent, expected: null })).rejects.toMatchObject({ code: "EAGAIN" });
  await expect(backend.lstat("/new")).rejects.toMatchObject({ code: "ENOENT" });
});

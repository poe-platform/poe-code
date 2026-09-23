import { vol } from "memfs";
import * as immediate from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { createReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import type { FileSystem } from "../src/contracts/filesystem.js";
import { RealFileSystem } from "../src/fs/real/index.js";
import { createZipCommand } from "../../safe-bash/src/commands/archive/zip.js";
import { createUnzipCommand } from "../../safe-bash/src/commands/archive/unzip.js";
import type { CommandDefinition } from "../../safe-bash/src/contracts/index.js";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { ...fs, constants: fs.constants };
});

beforeEach(() => { vi.restoreAllMocks(); vol.reset(); vol.fromJSON({ "/machine/work/input": "abc\n" }); });

async function run(fs: FileSystem, command: CommandDefinition, args: string[]) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await command.execute({ command: command.name, args, fs, cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout.push(bytes); } }, stderr: { async write(bytes) { stderr.push(bytes); } },
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

it("creates ZIP bytes on a rooted real adapter and refuses extraction without atomic ancestry", async () => {
  const fs = new RealFileSystem("/machine");
  expect(await run(fs, createZipCommand(), ["-q", "archive.zip", "input"])).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  await fs.rm("/work/input");
  expect(await run(fs, createUnzipCommand(), ["-p", "archive.zip", "input"])).toEqual({ exitCode: 0, stdout: "abc\n", stderr: "" });
  const archive = await fs.readFile("/work/archive.zip");
  expect(await run(fs, createUnzipCommand(), ["archive.zip"])).toEqual({ exitCode: 2, stdout: "Archive:  archive.zip\n", stderr: "unzip: extraction requires atomic staging ancestry verification\n" });
  expect(await fs.readFile("/work/archive.zip")).toEqual(archive);
  expect((await fs.readdir("/work")).map(entry => entry.name)).toEqual(["archive.zip"]);
});

it("reads the reported native ZIP fixture and preserves the real tree on extraction refusal", async () => {
  const fs = new RealFileSystem("/machine");
  await fs.rm("/work/input");
  await fs.writeFile("/work/archive.zip", Buffer.from("UEsDBBQAAAAAAAAAIVhOgYhHBAAAAAQAAAAFAAAAaW5wdXRhYmMKUEsBAhQDFAAAAAAAAAAhWE6BiEcEAAAABAAAAAUAAAAAAAAAAAAAAIABAAAAAGlucHV0UEsFBgAAAAABAAEAMwAAACcAAAAAAA==", "base64"));
  expect(await run(fs, createUnzipCommand(), ["-p", "archive.zip", "input"])).toEqual({ exitCode: 0, stdout: "abc\n", stderr: "" });
  expect(await run(fs, createUnzipCommand(), ["archive.zip"])).toEqual({ exitCode: 2, stdout: "Archive:  archive.zip\n", stderr: "unzip: extraction requires atomic staging ancestry verification\n" });
  expect((await fs.readdir("/work")).map(entry => entry.name)).toEqual(["archive.zip"]);
});

async function staged() {
  const fs = new RealFileSystem("/machine");
  const parent = await fs.lstat("/work");
  const receipt = await fs.createStagedFile("/work/.stage", "entry", { type: "file", data: Buffer.from("original") }, { parent });
  return { fs, parent, receipt };
}

it("preserves a substituted staging entry and refuses publication and cleanup", async () => {
  const { fs, parent, receipt } = await staged();
  await fs.rename(receipt.file.path, "/work/saved");
  await fs.writeFile(receipt.file.path, Buffer.from("foreign"));
  await expect(fs.publishStagedFile(receipt, "/work/output", { parent, destination: null })).rejects.toMatchObject({ code: "EAGAIN" });
  await expect(fs.removeStagedFile(receipt)).rejects.toMatchObject({ code: "EAGAIN" });
  expect(Buffer.from(await fs.readFile(receipt.file.path)).toString()).toBe("foreign");
});

it("preserves every staging child when cleanup encounters an unexpected entry", async () => {
  const { fs, receipt } = await staged();
  await fs.writeFile(`${receipt.directory.path}/foreign`, Buffer.from("foreign"));
  await expect(fs.removeStagedFile(receipt)).rejects.toMatchObject({ code: "ENOTEMPTY" });
  expect(Buffer.from(await fs.readFile(receipt.file.path)).toString()).toBe("original");
});

it("refuses a destination created after the absence observation", async () => {
  const { fs, parent, receipt } = await staged();
  await fs.writeFile("/work/output", Buffer.from("foreign"));
  await expect(fs.publishStagedFile(receipt, "/work/output", { parent, destination: null })).rejects.toMatchObject({ code: "EAGAIN" });
  await fs.removeStagedFile(receipt);
  expect(Buffer.from(await fs.readFile("/work/output")).toString()).toBe("foreign");
});

it("refuses an exchanged staging parent", async () => {
  const { fs, parent, receipt } = await staged();
  await fs.rename("/work", "/saved");
  await fs.mkdir("/work");
  await expect(fs.createStagedFile("/work/.new", "entry", { type: "file", data: Buffer.from("new") }, { parent })).rejects.toMatchObject({ code: "EAGAIN" });
  await expect(fs.publishStagedFile(receipt, "/work/output", { parent, destination: null })).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readdir("/work")).toEqual([]);
});

it("updates nested archive members and refuses unsupported real extraction", async () => {
  const fs = new RealFileSystem("/machine");
  await fs.mkdir("/work/tree");
  await fs.writeFile("/work/tree/child", Buffer.from("first"));
  expect((await run(fs, createZipCommand(), ["-qr", "archive.zip", "tree"])).exitCode).toBe(0);
  await fs.writeFile("/work/tree/child", Buffer.from("second"));
  expect(await run(fs, createZipCommand(), ["-qr", "archive.zip", "tree"])).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  await fs.rm("/work/tree", { recursive: true });
  expect(await run(fs, createUnzipCommand(), ["-p", "archive.zip", "tree/child"])).toEqual({ exitCode: 0, stdout: "second", stderr: "" });
  const archive = await fs.readFile("/work/archive.zip");
  expect(await run(fs, createUnzipCommand(), ["-q", "archive.zip"])).toMatchObject({ exitCode: 2, stderr: "unzip: extraction requires atomic staging ancestry verification\n" });
  await expect(fs.lstat("/work/tree/child")).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile("/work/archive.zip")).toEqual(archive);
});

for (const wrapper of ["mount", "device", "scope"] as const) it(`preserves ZIP creation and extraction refusal through ${wrapper} views`, async () => {
  const backing = new RealFileSystem("/machine");
  const fs = wrapper === "mount" ? createMountFileSystem({ root: backing }) : wrapper === "device" ? createDeviceFileSystem(backing) : scopeFileSystem(backing, () => {}, new AbortController().signal);
  expect(await run(fs, createZipCommand(), ["-q", "archive.zip", "input"])).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  await fs.rm("/work/input");
  expect(await run(fs, createUnzipCommand(), ["-p", "archive.zip", "input"])).toEqual({ exitCode: 0, stdout: "abc\n", stderr: "" });
  expect(await run(fs, createUnzipCommand(), ["-q", "archive.zip"])).toMatchObject({ exitCode: 2, stderr: "unzip: extraction requires atomic staging ancestry verification\n" });
  expect((await backing.readdir("/work")).map(entry => entry.name)).toEqual(["archive.zip"]);
});

it("withholds trusted staging from read-only, quota, and incomplete views", async () => {
  const fs = new RealFileSystem("/machine");
  expect(fs.capabilities.atomicFileStaging).not.toBe(true);
  expect(createReadOnlyFileSystem(fs).capabilities.trustedOwnedStaging).toBe(false);
  expect(withFileSystemQuota(fs, { maxBytes: 100 }).capabilities.trustedOwnedStaging).toBe(false);
  const incomplete = new Proxy(fs, { get(target, key) {
    if (key === "publishStagedFile") return undefined;
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scoped = scopeFileSystem(incomplete, () => {}, new AbortController().signal);
  expect(scoped.capabilities.trustedOwnedStaging).toBe(false);
  const parent = await fs.lstat("/work");
  await expect(scoped.createStagedFile!("/work/.stage", "entry", { type: "file", data: Buffer.from("new") }, { parent })).rejects.toMatchObject({ code: "ENOTSUP" });
});

it("returns its original creation receipt when cancellation arrives during commit", async () => {
  const fs = new RealFileSystem("/machine");
  const parent = await fs.lstat("/work");
  const controller = new AbortController();
  const write = immediate.writeFileSync;
  vi.spyOn(immediate, "writeFileSync").mockImplementation((file, data) => {
    write(file, data);
    controller.abort(false);
  });
  const receipt = await fs.createStagedFile("/work/.stage", "entry", { type: "file", data: Buffer.from("original") }, { parent, signal: controller.signal });
  expect(controller.signal.aborted).toBe(true);
  await fs.removeStagedFile(receipt);
  expect((await fs.readdir("/work")).map(entry => entry.name)).toEqual(["input"]);
});

it("preserves cancellation reasons and creates nothing before admission", async () => {
  const fs = new RealFileSystem("/machine");
  const parent = await fs.lstat("/work");
  const controller = new AbortController(); controller.abort(false);
  await expect(fs.createStagedFile("/work/.stage", "entry", { type: "file", data: Buffer.from("original") }, { parent, signal: controller.signal })).rejects.toBe(false);
  expect((await fs.readdir("/work")).map(entry => entry.name)).toEqual(["input"]);
});

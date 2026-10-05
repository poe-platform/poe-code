import { expect, test, vi } from "vitest";
import { createMemoryFileSystem, type FileSystem } from "../src/index.js";
import { Shell } from "../../safe-bash/src/core.js";
import { zipCommands } from "safe-bash-command-zip";
import { unzipCommands } from "safe-bash-command-unzip";
import { applyPatchCommands } from "safe-bash-command-apply-patch";

// Caller adapters can provide atomic conditional mutations without retained
// staging writers. Keep capability queries and confined views consistent.
function caller(backing: FileSystem): FileSystem {
  const capabilities = { ...backing.capabilities, retainedStagingWrite: false,
    retainedStagingCleanup: false, atomicStagedFileMutation: false };
  const receipts = new WeakSet<object>();
  return new Proxy(backing, { get(target, key) {
    if (key === "capabilities") return capabilities;
    if (key === "capabilitiesFor") return async () => capabilities;
    if (key === "confineExtraction") return async (...args: Parameters<NonNullable<FileSystem["confineExtraction"]>>) => caller(await target.confineExtraction!(...args));
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      expect(args[3].retainCleanup).not.toBe(true);
      const stage = await target.createStagedFile!(...args);
      const receipt = Object.freeze({ ...stage, writer: undefined, cleanup: undefined });
      receipts.add(receipt);
      return receipt;
    };
    if (key === "publishStagedFile" || key === "removeStagedFile") return async (...args: unknown[]) => {
      expect(receipts.has(args[0] as object), "caller owns the original receipt").toBe(true);
      return Reflect.apply(target[key]!, target, args);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("caller-backed ZIP creation and update preserve binary members", async () => {
  const fs = caller(createMemoryFileSystem());
  await fs.mkdir("/work");
  const first = Uint8Array.of(137, 80, 78, 71, 0, 255);
  const second = Uint8Array.of(0, 254, 128, 10);
  await fs.writeFile("/work/a.png", first);
  await fs.writeFile("/work/b.png", second);
  const shell = new Shell({ fs }).use(zipCommands()).use(unzipCommands()).use(applyPatchCommands());
  try {
    const created = await shell.exec("cd /work && zip -j /work/archive.zip *.png");
    expect(created.exitCode, created.stderr).toBe(0);
    await fs.writeFile("/work/a.png", second);
    const updated = await shell.exec("cd /work && zip -j /work/archive.zip a.png");
    expect(updated.exitCode, updated.stderr).toBe(0);
    for (const name of ["a.png", "b.png"]) {
      const result = await shell.exec(`unzip -p /work/archive.zip ${name} > /extracted`);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(await fs.readFile("/extracted")).toEqual(second);
    }
    expect((await fs.readdir("/work")).map(entry => entry.name).sort()).toEqual(["a.png", "archive.zip", "b.png"]);
  } finally { await shell.dispose(); }
});

test("caller-backed apply_patch updates conditional targets", async () => {
  const fs = caller(createMemoryFileSystem());
  await fs.writeFile("/target", new TextEncoder().encode("old\n"));
  await fs.chmod!("/target", 0o751);
  const before = await fs.lstat("/target");
  const shell = new Shell({ fs }).use(zipCommands()).use(unzipCommands()).use(applyPatchCommands());
  try {
    const result = await shell.exec("apply_patch", { stdin: "*** Begin Patch\n*** Update File: /target\n@@\n-old\n+new★\n*** End Patch\n" });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(await fs.readFile("/target")).toEqual(new TextEncoder().encode("new★\n"));
    expect(await fs.lstat("/target")).toMatchObject({ ino: before.ino, mode: before.mode });
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["target"]);
  } finally { await shell.dispose(); }
});

for (const command of ["zip", "apply_patch"] as const) test(`caller-backed ${command} preserves targets on publication failure`, async () => {
  const backing = createMemoryFileSystem();
  const fs = caller(backing);
  await fs.writeFile("/target", new TextEncoder().encode("old\n"));
  const shell = new Shell({ fs }).use(zipCommands()).use(applyPatchCommands());
  const method = command === "zip" ? "publishStagedFile" : "writeFileConditional";
  const publish = vi.spyOn(backing, method).mockRejectedValue(new Error("publication failed"));
  try {
    const result = await shell.exec(command === "zip" ? "zip /archive.zip /target" : "apply_patch", {
      stdin: "*** Begin Patch\n*** Update File: /target\n@@\n-old\n+new\n*** End Patch\n",
    });
    expect(result.exitCode).not.toBe(0);
    expect(publish).toHaveBeenCalled();
    expect(await fs.readFile("/target")).toEqual(new TextEncoder().encode("old\n"));
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["target"]);
  } finally { publish.mockRestore(); await shell.dispose(); }
});

for (const failure of ["conflict", "limit", "cancel"] as const) test(`caller apply_patch rejects ${failure} without replacing bytes`, async () => {
  const backing = createMemoryFileSystem();
  const fs = caller(backing);
  await fs.writeFile("/target", new TextEncoder().encode("old\n"));
  const controller = new AbortController();
  const write = backing.writeFileConditional.bind(backing);
  const intercepted = vi.spyOn(backing, "writeFileConditional").mockImplementation(async (...args) => {
    if (failure === "conflict") await backing.writeFile("/target", new TextEncoder().encode("foreign\n"));
    if (failure === "cancel") controller.abort(new Error("cancelled"));
    return write(...args);
  });
  const shell = new Shell({ fs }).use(applyPatchCommands({ limits: { maxFileBytes: failure === "limit" ? 4 : 1024 } }));
  try {
    const result = await shell.exec("apply_patch", { signal: controller.signal,
      stdin: "*** Begin Patch\n*** Update File: /target\n@@\n-old\n+replacement\n*** End Patch\n",
    }).catch(() => ({ exitCode: 1 }));
    expect(result.exitCode).not.toBe(0);
    if (failure === "limit") expect(intercepted).not.toHaveBeenCalled();
    else expect(intercepted).toHaveBeenCalledOnce();
    expect(await fs.readFile("/target")).toEqual(new TextEncoder().encode(failure === "conflict" ? "foreign\n" : "old\n"));
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["target"]);
  } finally { intercepted.mockRestore(); await shell.dispose(); }
});

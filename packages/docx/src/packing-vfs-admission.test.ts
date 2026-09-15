import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/core";
import { DocumentBudget } from "./budget.js";
import { admitPackingFiles } from "./packing-vfs-admission.js";

function fixture() {
  const volume = Volume.fromJSON({ "/tree/first.xml": "first", "/tree/nested/last.xml": "last" });
  const visited: string[] = [];
  const filesystem = {
    async lstat(path: string) {
      visited.push(path);
      const stat = volume.lstatSync(path);
      return { type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", size: stat.size } as FileStat;
    },
    async realpath(path: string) { return String(volume.realpathSync(path)); }
  } as FileSystem;
  const files = [{ path: "/tree/first.xml", bytes: 5 }, { path: "/tree/nested/last.xml", bytes: 4 }];
  const context = { filesystem, signal: new AbortController().signal, budget: new DocumentBudget() };
  return { volume, visited, files, context };
}

describe("packing VFS admission", () => {
  it("admits every explicitly declared file and canonical ancestor", async () => {
    const { files, context, visited } = fixture();
    await admitPackingFiles(files, context);
    expect(visited).toEqual(["/tree", "/tree/first.xml", "/tree/nested", "/tree/nested/last.xml"]);
  });
  it("rejects a later symlink without following its target", async () => {
    const { files, context, volume } = fixture();
    volume.unlinkSync(files[1]!.path);
    volume.symlinkSync(files[0]!.path, files[1]!.path);
    await expect(admitPackingFiles(files, context)).rejects.toMatchObject({ code: "invalid-container" });
  });
  it("rejects a symlink ancestor", async () => {
    const { files, context, volume } = fixture();
    volume.renameSync("/tree/nested", "/elsewhere");
    volume.symlinkSync("/elsewhere", "/tree/nested");
    await expect(admitPackingFiles(files, context)).rejects.toMatchObject({ code: "invalid-container" });
  });
  it("rejects unsupported file kinds", async () => {
    const { files, context } = fixture(), lstat = context.filesystem.lstat.bind(context.filesystem);
    context.filesystem.lstat = async (path, options) => ({ ...await lstat(path, options), ...(path === files[1]!.path ? { type: "fifo" as never } : {}) });
    await expect(admitPackingFiles(files, context)).rejects.toMatchObject({ code: "invalid-container" });
  });
  it("rejects stale lengths and missing files", async () => {
    const { files, context, volume } = fixture();
    files[1]!.bytes = 7;
    await expect(admitPackingFiles(files, context)).rejects.toMatchObject({ code: "invalid-container" });
    volume.unlinkSync(files[1]!.path);
    await expect(admitPackingFiles(files, context)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("observes cancellation during the final file check", async () => {
    const { files, context } = fixture(), controller = new AbortController();
    const realpath = context.filesystem.realpath.bind(context.filesystem);
    context.filesystem.realpath = async (path, options) => {
      const resolved = await realpath(path, options);
      if (path === files[1]!.path) controller.abort();
      return resolved;
    };
    await expect(admitPackingFiles(files, { ...context, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  });
  it("honors cancellation before VFS admission", async () => {
    const { files, context, visited } = fixture(), controller = new AbortController();
    controller.abort();
    await expect(admitPackingFiles(files, { ...context, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(visited).toEqual([]);
  });
});

import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { createDefaultFileSystem } from "#task-list-host";
import type { TaskListFs } from "./types.js";

export function taskListFileSystem(fs: TaskListFs | FileSystem = createDefaultFileSystem()): TaskListFs {
  if (!("capabilities" in fs)) return fs;
  return {
    async lstat(path) { const stat = await fs.lstat(path); return { isSymbolicLink: () => stat.type === "symlink" }; },
    mkdir: (path, options) => fs.mkdir(path, options),
    async readFile(path) { return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await fs.readFile(path)); },
    async readdir(path) { return (await fs.readdir(path)).map(entry => entry.name); },
    rename: (from, to) => fs.rename(from, to),
    async rmdir(path) {
      if (!fs.rmdir) throw new Error("Task lists require filesystem rmdir support.");
      await fs.rmdir(path);
    },
    async stat(path) {
      const stat = await fs.stat(path);
      return { isDirectory: () => stat.type === "directory", isFile: () => stat.type === "file", mtimeMs: stat.mtimeMs };
    },
    async unlink(path) {
      if (!fs.unlink) throw new Error("Task lists require filesystem unlink support.");
      await fs.unlink(path);
    },
    async writeFile(path, data, options) {
      const flag = typeof options === "object" ? options.flag : undefined;
      if (flag !== undefined && flag !== "w" && flag !== "wx" && flag !== "a" && flag !== "ax") throw new Error("Unsupported task-list write flag.");
      await fs.writeFile(path, typeof data === "string" ? new TextEncoder().encode(data) : data, { flag });
    }
  };
}

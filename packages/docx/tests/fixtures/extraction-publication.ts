import { Volume } from "memfs";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/core";

export function extractionPublication(input: Uint8Array) {
  const volume = Volume.fromJSON({"/input": Buffer.from(input), "/packed": "", "/keep": "Retained"}), identityScope = {};
  const stat = async (path: string): Promise<FileStat> => {
    const s = volume.lstatSync(path);
    return {type: s.isDirectory() ? "directory" : "file", size: s.size, mode: s.mode, mtimeMs: s.mtimeMs, atimeMs: s.atimeMs, ctimeMs: s.ctimeMs, ino: s.ino, dev: s.dev, identityScope};
  };
  const fs = {
    capabilities: {write: true, mkdir: true, explicitDirectories: true, atomicFileMutation: true, atomicDirectoryMetadata: true},
    lstat: stat, stat, async realpath(path: string) {return String(volume.realpathSync(path));}, async access(path: string, mode: number) {volume.accessSync(path, mode);},
    async prepareDirectory(path: string, options: {parent: FileStat}) {const parent = await stat(path.slice(0, path.lastIndexOf("/")) || "/"); if (parent.ino !== options.parent.ino) throw new Error("Original parent identity changed"); volume.mkdirSync(path); return stat(path);},
    async writeFileConditional(path: string, data: Uint8Array, options: {parent: FileStat}) {const parent = await stat(path.slice(0, path.lastIndexOf("/")) || "/"); if (parent.ino !== options.parent.ino) throw new Error("Original parent identity changed"); volume.writeFileSync(path, data, {flag: "wx"}); return stat(path);},
    async readFile(path: string) {return new Uint8Array(volume.readFileSync(path) as Buffer);}
  } as unknown as FileSystem;
  return {volume, fs};
}

import { Volume } from "memfs";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/core";
export function publication(bytes: Uint8Array, fail = false) {
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) });
  volume.mkdirSync("/out");
  const scope = {};
  const stat = async (path: string): Promise<FileStat> => {
    const value = volume.lstatSync(path);
    return {
      type: value.isDirectory() ? "directory" : "file",
      size: value.size,
      mode: value.mode,
      mtimeMs: value.mtimeMs,
      ctimeMs: value.ctimeMs,
      atimeMs: value.atimeMs,
      ino: value.ino,
      dev: value.dev,
      nlink: value.nlink,
      identityScope: scope,
      revision: value.mtimeMs
    };
  };
  let publications = 0;
  const fs = {
    capabilities: { atomicFileStaging: true, write: true },
    lstat: stat,
    stat,
    async readFile(path: string) {
      return new Uint8Array(volume.readFileSync(path) as Uint8Array);
    },
    async realpath(path: string) {
      return String(volume.realpathSync(path));
    },
    async access(path: string, mode: number) {
      volume.accessSync(path, mode);
    },
    createStagedFile: (async (directory, name, content) => {
      if (content.type !== "file") throw new Error("Unsupported original fixture staging");
      volume.mkdirSync(directory);
      volume.writeFileSync(`${directory}/${name}`, content.data);
      return {
        parent: { path: "/out", stat: await stat("/out") },
        directory: { path: directory, stat: await stat(directory) },
        file: { path: `${directory}/${name}`, stat: await stat(`${directory}/${name}`) }
      };
    }) as NonNullable<FileSystem["createStagedFile"]>,
    publishStagedFile: (async (stage, path) => {
      if (fail && publications++ === 1) throw new Error("Original second publication failure");
      volume.renameSync(stage.file.path, path);
    }) as NonNullable<FileSystem["publishStagedFile"]>,
    removeStagedFile: (async (stage) => {
      volume.rmSync(stage.directory.path, { recursive: true });
    }) as NonNullable<FileSystem["removeStagedFile"]>
  } as unknown as FileSystem;
  return { fs, volume };
}

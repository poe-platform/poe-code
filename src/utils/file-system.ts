import type { Stats } from "node:fs";

export interface FileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
  writeFile(
    path: string,
    data: string | NodeJS.ArrayBufferView,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<Stats>;
  lstat(path: string): Promise<Stats>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm?(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  copyFile?(src: string, dest: string): Promise<void>;
  chmod?(path: string, mode: number): Promise<void>;
}

export type PathExistsFn = (path: string) => Promise<boolean>;

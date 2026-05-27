import * as nodeFs from "node:fs/promises";

export interface StateFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: BufferEncoding | { encoding?: BufferEncoding }
  ): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{
    isFile(): boolean;
    mtimeMs: number;
  }>;
  unlink(path: string): Promise<void>;
}

export const defaultStateFs = nodeFs as unknown as StateFileSystem;

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

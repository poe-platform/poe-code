import * as nodeFs from "node:fs/promises";
import path from "node:path";
import { hasOwnErrorCode } from "../errors.js";

export interface StateFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: BufferEncoding | { encoding?: BufferEncoding; flag?: string; mode?: number }
  ): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{
    isFile(): boolean;
    mtimeMs: number;
  }>;
  lstat?(path: string): Promise<{
    isSymbolicLink(): boolean;
  }>;
  unlink(path: string): Promise<void>;
}

export const defaultStateFs = nodeFs as unknown as StateFileSystem;

export function isNotFoundError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

export async function assertPathHasNoSymbolicLinks(
  fs: StateFileSystem,
  targetPath: string,
  message: string
): Promise<void> {
  if (fs.lstat === undefined) {
    return;
  }

  const absolutePath = path.resolve(targetPath);
  const root = path.parse(absolutePath).root;
  let inspectedPath = root;

  for (const segment of absolutePath.slice(root.length).split(path.sep).filter(Boolean)) {
    inspectedPath = path.join(inspectedPath, segment);
    try {
      if ((await fs.lstat(inspectedPath)).isSymbolicLink()) {
        throw new Error(`${message}: ${targetPath}`);
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }

      throw error;
    }
  }
}

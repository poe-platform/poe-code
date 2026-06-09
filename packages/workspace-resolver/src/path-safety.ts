import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import type { ResolverFileSystem } from "./types.js";

export async function assertPathHasNoSymbolicLinks(
  fs: Pick<ResolverFileSystem, "lstat">,
  target: string
): Promise<void> {
  const absolutePath = path.resolve(target);
  const root = path.parse(absolutePath).root;
  let currentPath = root;

  for (const segment of absolutePath.slice(root.length).split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);
    try {
      if ((await fs.lstat(currentPath)).isSymbolicLink()) {
        throw new Error(`Workspace path "${target}" must not be a symbolic link.`);
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

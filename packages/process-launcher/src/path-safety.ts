import path from "node:path";
import { hasOwnErrorCode } from "./errors.js";
import type { LauncherFileSystem } from "./types.js";

function isNotFoundError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

export async function assertPathHasNoSymbolicLinks(
  fs: Pick<LauncherFileSystem, "lstat">,
  targetPath: string
): Promise<void> {
  const absolutePath = path.resolve(targetPath);
  const root = path.parse(absolutePath).root;
  let inspectedPath = root;

  for (const segment of absolutePath.slice(root.length).split(path.sep).filter(Boolean)) {
    inspectedPath = path.join(inspectedPath, segment);
    try {
      if ((await fs.lstat(inspectedPath)).isSymbolicLink()) {
        throw new Error(`Refusing to use path containing symbolic link: ${targetPath}`);
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }
}

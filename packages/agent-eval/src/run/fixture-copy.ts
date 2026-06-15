import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export async function assertNoSymlinksInDirectoryTree(
  rootDir: string,
  label: string
): Promise<void> {
  await walkDirectoryTree(rootDir, label);
}

async function walkDirectoryTree(targetPath: string, label: string): Promise<void> {
  const targetStat = await lstat(targetPath);
  if (targetStat.isSymbolicLink()) {
    throw new Error(`${label} must not contain symbolic links: ${targetPath}`);
  }

  if (!targetStat.isDirectory()) {
    return;
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`${label} must not contain symbolic links: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      await walkDirectoryTree(entryPath, label);
    }
  }
}

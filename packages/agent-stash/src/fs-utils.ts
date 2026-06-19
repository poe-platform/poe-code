import path from "node:path";
import type { AgentStashFileSystem } from "./types.js";
import { hasOwnErrorCode } from "./error-codes.js";

export async function pathExists(fs: Pick<AgentStashFileSystem, "stat">, targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

export async function readFileIfExists(
  fs: Pick<AgentStashFileSystem, "readFile">,
  targetPath: string
): Promise<string | null> {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

export async function writeTextFile(
  fs: Pick<AgentStashFileSystem, "mkdir" | "writeFile">,
  targetPath: string,
  content: string
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, { encoding: "utf8" });
}

export async function removePath(
  fs: Pick<AgentStashFileSystem, "rm" | "unlink">,
  targetPath: string
): Promise<void> {
  if (fs.rm) {
    await fs.rm(targetPath, { recursive: true, force: true });
    return;
  }
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

export async function assertNotSymlink(
  fs: Pick<AgentStashFileSystem, "lstat">,
  targetPath: string
): Promise<void> {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${targetPath}`);
    }
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

export async function assertNoSymlinkAncestors(
  fs: Pick<AgentStashFileSystem, "lstat">,
  targetPath: string,
  rootPath: string
): Promise<void> {
  const root = path.resolve(rootPath);
  const ancestors: string[] = [];
  let current = path.resolve(path.dirname(targetPath));
  while (current !== root && current.startsWith(`${root}${path.sep}`)) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  for (const ancestor of ancestors.reverse()) {
    await assertNotSymlink(fs, ancestor);
  }
}

export function isDirectory(stat: { isDirectory?: () => boolean; mode?: number }): boolean {
  if (stat.isDirectory) {
    return stat.isDirectory();
  }
  return stat.mode !== undefined && (stat.mode & 0o170000) === 0o040000;
}

export function isFile(stat: { isFile?: () => boolean; mode?: number }): boolean {
  if (stat.isFile) {
    return stat.isFile();
  }
  return stat.mode !== undefined && (stat.mode & 0o170000) === 0o100000;
}

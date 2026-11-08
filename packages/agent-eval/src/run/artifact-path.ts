import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { hasOwnErrorCode } from "../error-codes.js";

export async function ensureRunArtifactDirectory(
  sourceRootDir: string,
  runDir: string
): Promise<void> {
  const parentDir = path.dirname(runDir);
  await assertRunArtifactPath(sourceRootDir, parentDir);
  await mkdir(parentDir, { recursive: true });
  await assertRunArtifactPath(sourceRootDir, parentDir);
  await mkdir(runDir, { recursive: true });
  await assertRunArtifactPath(sourceRootDir, runDir);
}

export async function assertRunArtifactPath(
  sourceRootDir: string,
  targetPath: string
): Promise<void> {
  const sourceRoot = path.resolve(sourceRootDir);
  const target = path.resolve(targetPath);
  if (!isPathInside(sourceRoot, target)) {
    return;
  }

  let current = sourceRoot;
  const relativePath = path.relative(sourceRoot, target);
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Run artifact path must not traverse a symbolic link: ${current}`);
      }
    } catch (error) {
      if (isMissingPath(error)) {
        return;
      }
      throw error;
    }
  }
}

function isPathInside(rootDir: string, targetPath: string): boolean {
  const relativePath = path.relative(rootDir, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}

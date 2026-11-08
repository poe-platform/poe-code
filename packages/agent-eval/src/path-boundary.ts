import { realpath } from "node:fs/promises";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";

type CanonicalFs = { realpath(targetPath: string): Promise<string> };

export function resolveContainedPath(
  rootDir: string,
  configuredPath: string,
  field: string
): string {
  const absoluteRootDir = path.resolve(rootDir);
  const resolved = path.resolve(absoluteRootDir, configuredPath);
  assertWithin(absoluteRootDir, resolved, field, false);
  return resolved;
}

export async function assertCanonicalContainedPath(
  rootDir: string,
  targetPath: string,
  field: string
): Promise<void> {
  const canonicalRoot = await realpath(path.resolve(rootDir));
  const canonicalTarget = await realpath(targetPath);
  assertWithin(canonicalRoot, canonicalTarget, field, true);
}

export async function assertFsCanonicalContainedPath(
  fs: CanonicalFs,
  rootDir: string,
  targetPath: string,
  field: string
): Promise<void> {
  const canonicalRoot = await fs.realpath(path.resolve(rootDir));
  const canonicalTarget = await fs.realpath(targetPath);
  assertWithin(canonicalRoot, canonicalTarget, field, true);
}

export async function assertFsCanonicalContainedPathIfPresent(
  fs: CanonicalFs,
  rootDir: string,
  targetPath: string,
  field: string
): Promise<boolean> {
  try {
    await assertFsCanonicalContainedPath(fs, rootDir, targetPath, field);
    return true;
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

export async function assertCanonicalDestinationPath(
  rootDir: string,
  targetPath: string,
  field: string
): Promise<void> {
  const canonicalRoot = await realpath(path.resolve(rootDir));
  let current = path.resolve(targetPath);

  while (true) {
    try {
      const canonicalAncestor = await realpath(current);
      assertWithin(canonicalRoot, canonicalAncestor, field, true);
      return;
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`${field} must stay within the canonical ${fieldRootDescription(field)}.`);
    }
    current = parent;
  }
}

function assertWithin(rootDir: string, targetPath: string, field: string, canonical: boolean): void {
  const relative = path.relative(rootDir, targetPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    const prefix = canonical ? "canonical " : "";
    throw new Error(`${field} must stay within the ${prefix}${fieldRootDescription(field)}.`);
  }
}

function fieldRootDescription(field: string): string {
  if (field === "source.config" || field === "eval.yaml" || field === "plan.md") {
    return "source directory";
  }
  return field === "oracle.path" ? "eval directory" : "clone directory";
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}

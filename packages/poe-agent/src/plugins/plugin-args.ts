import path from "node:path";
import { hasOwnErrorCode } from "../error-codes.js";

type PathInspectionFileSystem = {
  lstat(filePath: string): Promise<{ isSymbolicLink(): boolean }>;
};

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getRequiredString(args: unknown, key: string, allowEmptyString = false): string {
  if (!isObjectRecord(args)) {
    throw new Error(`Tool argument "${key}" must be a string`);
  }

  const value = args[key];

  if (typeof value !== "string") {
    throw new Error(`Tool argument "${key}" must be a string`);
  }

  if (!allowEmptyString && value.trim().length === 0) {
    throw new Error(`Tool argument "${key}" must not be empty`);
  }

  return value;
}

export function getOptionalString(args: unknown, key: string): string | undefined {
  if (!isObjectRecord(args)) {
    throw new Error(`Tool argument "${key}" must be a string`);
  }

  const value = args[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Tool argument "${key}" must be a string`);
  }

  return value;
}

export function getOptionalBoolean(args: unknown, key: string): boolean | undefined {
  if (!isObjectRecord(args)) {
    throw new Error(`Tool argument "${key}" must be a boolean`);
  }

  const value = args[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Tool argument "${key}" must be a boolean`);
  }

  return value;
}

export function getOptionalNumber(args: unknown, key: string): number | undefined {
  if (!isObjectRecord(args)) {
    throw new Error(`Tool argument "${key}" must be a number`);
  }

  const value = args[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Tool argument "${key}" must be a finite number`);
  }

  return value;
}

export function getOptionalNonNegativeInteger(args: unknown, key: string): number | undefined {
  if (!isObjectRecord(args)) {
    throw new Error(`Tool argument "${key}" must be a non-negative integer`);
  }

  const value = args[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Tool argument "${key}" must be a non-negative integer`);
  }

  return value;
}

export function assertAllowedPathEntries(
  allowedPaths: readonly string[],
  key = "allowedPaths"
): void {
  for (const [index, allowedPath] of allowedPaths.entries()) {
    if (allowedPath.trim().length === 0) {
      throw new Error(`${key}[${index}] must not be empty`);
    }
  }
}

export function normalizeAllowedPaths(cwd: string, allowedPaths: string[] | undefined): string[] {
  const entries = allowedPaths ?? [cwd];
  assertAllowedPathEntries(entries);
  return entries.map((allowedPath) => path.resolve(cwd, allowedPath));
}

export function resolveAllowedPath(cwd: string, allowedPaths: string[], inputPath: string): string {
  const resolvedPath = path.resolve(cwd, inputPath);
  const isAllowed = allowedPaths.some(allowedPath => {
    if (allowedPath === resolvedPath) {
      return true;
    }

    const rel = path.relative(allowedPath, resolvedPath);
    return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
  });

  if (!isAllowed) {
    throw new Error(`Path is outside allowed paths: ${inputPath}`);
  }

  return resolvedPath;
}

export async function assertNoSymbolicLinkPath(
  fs: PathInspectionFileSystem,
  filePath: string
): Promise<void> {
  const absolutePath = path.resolve(filePath);
  const root = path.parse(absolutePath).root;
  let inspectedPath = root;

  for (const segment of absolutePath.slice(root.length).split(path.sep).filter(Boolean)) {
    inspectedPath = path.join(inspectedPath, segment);
    try {
      if ((await fs.lstat(inspectedPath)).isSymbolicLink()) {
        throw new Error(`Path may not contain symbolic links: ${filePath}`);
      }
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
  }
}

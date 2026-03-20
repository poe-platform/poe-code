import path from "node:path";

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

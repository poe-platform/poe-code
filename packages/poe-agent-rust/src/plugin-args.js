import { native } from "./native.js";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
export function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function getRequiredString(args, key, allowEmptyString = false) {
  if (!isObjectRecord(args)) throw new Error(`Tool argument "${key}" must be a string`);
  const value = args[key];
  const failure = native.validateAgentArgument(value, key, "string", false, allowEmptyString);
  if (failure !== null) throw new Error(failure);
  return value;
}
export function getOptionalString(args, key) {
  if (!isObjectRecord(args)) throw new Error(`Tool argument "${key}" must be a string`);
  const value = args[key];
  const failure = native.validateAgentArgument(value, key, "string", true, true);
  if (failure !== null) throw new Error(failure);
  return value;
}
export function getOptionalBoolean(args, key) {
  if (!isObjectRecord(args)) throw new Error(`Tool argument "${key}" must be a boolean`);
  const value = args[key];
  const failure = native.validateAgentArgument(value, key, "boolean", true, false);
  if (failure !== null) throw new Error(failure);
  return value;
}
export function getOptionalNumber(args, key) {
  if (!isObjectRecord(args)) throw new Error(`Tool argument "${key}" must be a number`);
  const value = args[key];
  const failure = native.validateAgentArgument(value, key, "number", true, false);
  if (failure !== null) throw new Error(failure);
  return value;
}
export function getOptionalNonNegativeInteger(args, key) {
  if (!isObjectRecord(args))
    throw new Error(`Tool argument "${key}" must be a non-negative integer`);
  const value = args[key];
  const failure = native.validateAgentArgument(value, key, "integer", true, false);
  if (failure !== null) throw new Error(failure);
  return value;
}

export function assertAllowedPathEntries(allowedPaths, key = "allowedPaths") {
  for (const [index, allowedPath] of allowedPaths.entries()) {
    if (allowedPath.trim().length === 0) {
      throw new Error(`${key}[${index}] must not be empty`);
    }
  }
}
export function normalizeAllowedPaths(cwd, allowedPaths) {
  const entries = allowedPaths ?? [cwd];
  assertAllowedPathEntries(entries);
  return entries.map((allowedPath) => path.resolve(cwd, allowedPath));
}
export function resolveAllowedPath(cwd, allowedPaths, inputPath) {
  const resolvedPath = path.resolve(cwd, inputPath);
  const isAllowed = allowedPaths.some((allowedPath) => {
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
export async function assertNoSymbolicLinkPath(fs, filePath) {
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

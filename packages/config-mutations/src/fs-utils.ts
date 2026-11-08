import type { FileSystem } from "./types.js";
import { hasOwnErrorCode } from "./error-codes.js";

/**
 * Check if an error is a "file not found" (ENOENT) error.
 */
export function isNotFound(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

/**
 * Read a file if it exists, returning null if not found.
 */
export async function readFileIfExists(
  fs: FileSystem,
  target: string
): Promise<string | null> {
  try {
    return await fs.readFile(target, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Check if a path exists (file or directory).
 */
export async function pathExists(
  fs: FileSystem,
  target: string
): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Create an ISO timestamp safe for use in filenames.
 * Replaces colons and dots with dashes.
 */
export function createTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

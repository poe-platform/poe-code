import path from "node:path";
import type { PathMapper } from "../types.js";

/**
 * Expand ~ shortcut to the provided home directory.
 */
export function expandHome(targetPath: string, homeDir: string): string {
  if (!targetPath?.startsWith("~")) {
    return targetPath;
  }

  // Handle ~./ -> ~/.
  if (targetPath.startsWith("~./")) {
    targetPath = `~/.${targetPath.slice(3)}`;
  }

  let remainder = targetPath.slice(1);

  // Remove leading slash or backslash
  if (remainder.startsWith("/") || remainder.startsWith("\\")) {
    remainder = remainder.slice(1);
  } else if (remainder.startsWith(".")) {
    // Handle ~/.
    remainder = remainder.slice(1);
    if (remainder.startsWith("/") || remainder.startsWith("\\")) {
      remainder = remainder.slice(1);
    }
  }

  return remainder.length === 0 ? homeDir : path.join(homeDir, remainder);
}

/**
 * Validate that a path is home-relative (starts with ~).
 * Throws if the path is not home-relative.
 */
export function validateHomePath(targetPath: string): void {
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    throw new Error("Target path must be a non-empty string.");
  }

  if (!targetPath.startsWith("~")) {
    throw new Error(
      `All target paths must be home-relative (start with ~). Received: "${targetPath}"`
    );
  }
}

/**
 * Resolve a path with optional path mapping for isolated configurations.
 * 1. Validates the path starts with ~
 * 2. Expands ~ to home directory
 * 3. If pathMapper is provided, maps the directory portion and reconstructs the path
 */
export function resolvePath(
  rawPath: string,
  homeDir: string,
  pathMapper?: PathMapper
): string {
  validateHomePath(rawPath);
  const expanded = expandHome(rawPath, homeDir);

  if (!pathMapper) {
    return expanded;
  }

  // Map the directory portion
  const rawDirectory = path.dirname(expanded);
  const mappedDirectory = pathMapper.mapTargetDirectory({
    targetDirectory: rawDirectory
  });
  const filename = path.basename(expanded);

  return filename.length === 0 ? mappedDirectory : path.join(mappedDirectory, filename);
}

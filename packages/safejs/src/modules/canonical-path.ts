import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { getOwnErrorCode } from "../error-codes.js";

// realpath answers ENOENT for a missing segment and ENOTDIR when a parent is a
// file. Both mean the segment is not an existing directory, so both walk up.
const MISSING_PATH_CODES: readonly string[] = ["ENOENT", "ENOTDIR"];

export type Realpath = (path: string) => Promise<string>;

// Canonicalizes as much of the path as exists and re-appends the segments that do
// not, so a path is checked after symlinks are followed rather than as written.
// The missing segments go back through resolve(), which collapses any `..` among
// them, so they cannot re-escape what realpath already pinned down.
export async function resolveCanonicalPath(realpath: Realpath, path: string): Promise<string> {
  const missingSegments: string[] = [];
  let current = path;

  while (true) {
    try {
      const canonicalCurrent = await realpath(current);
      return resolve(canonicalCurrent, ...missingSegments.reverse());
    } catch (error) {
      if (!MISSING_PATH_CODES.includes(getOwnErrorCode(error) ?? "")) {
        throw error;
      }

      const parent = dirname(current);

      if (parent === current) {
        return resolve(path);
      }

      missingSegments.push(basename(current));
      current = parent;
    }
  }
}

// Whether root contains path, root itself included. Both arguments must already be
// canonical: a `..` or a symlink left in either one would make the comparison lie.
export function containsPath(canonicalRoot: string, canonicalPath: string): boolean {
  const relativePath = relative(canonicalRoot, canonicalPath);

  // An empty relative path is root itself, which the root contains.
  return !(
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  );
}

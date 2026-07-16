import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { getOwnErrorCode } from "../error-codes.js";

// realpath answers ENOENT for a missing segment and ENOTDIR when a parent is a
// file. Both mean the segment is not an existing directory, so both walk up.
const MISSING_PATH_CODES: readonly string[] = ["ENOENT", "ENOTDIR"];

export type Realpath = (path: string) => Promise<string>;

// Which file a path names, as the filesystem itself answers it.
type PathIdentity = { dev: number; ino: number };

export type Stat = (path: string) => Promise<PathIdentity>;

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
//
// The rule: the filesystem has the deciding vote on containment, and comparing
// the canonical spellings is only a fast path that is trusted when it answers
// "contained". Two canonical paths can differ in spelling and still be the same
// place — on a case-insensitive filesystem (darwin's default) `/repo` and `/REPO`
// are one directory, and darwin's realpath echoes the spelling it was handed
// rather than the on-disk one, so canonicalization does not fold the case away.
// Comparing spellings can therefore only ever be wrong in one direction: it may
// answer "outside" for a path that resolves inside root, never the reverse. So
// "outside" is re-decided by walking the path's ancestors and asking the
// filesystem for each one's identity, which no spelling can lie about. Folding
// case here instead would be a hole: on a case-sensitive filesystem `/REPO/x` is
// genuinely a different file from `/repo/x`.
export async function containsPath(
  stat: Stat,
  canonicalRoot: string,
  canonicalPath: string
): Promise<boolean> {
  if (containsCanonicalSpelling(canonicalRoot, canonicalPath)) {
    return true;
  }

  return descendsFromRoot(stat, canonicalRoot, canonicalPath);
}

// Whether two canonical paths name the same place. Two spellings can name one
// place on a case-insensitive filesystem, so identity decides here for the same
// reason it decides containment above.
export async function isSamePath(
  stat: Stat,
  canonicalLeft: string,
  canonicalRight: string
): Promise<boolean> {
  if (canonicalLeft === canonicalRight) {
    return true;
  }

  const [left, right] = await Promise.all([
    readIdentity(stat, canonicalLeft),
    readIdentity(stat, canonicalRight)
  ]);

  return (
    left !== undefined && right !== undefined && left.dev === right.dev && left.ino === right.ino
  );
}

function containsCanonicalSpelling(canonicalRoot: string, canonicalPath: string): boolean {
  const relativePath = relative(canonicalRoot, canonicalPath);

  // An empty relative path is root itself, which the root contains.
  return !(
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  );
}

// Climbs the path's ancestors looking for root's own identity. A canonical path
// carries no symlinks and no `..`, so every ancestor it names is a real ancestor:
// finding root among them means the path descends from root whatever either one
// is spelled like.
async function descendsFromRoot(
  stat: Stat,
  canonicalRoot: string,
  canonicalPath: string
): Promise<boolean> {
  const root = await readIdentity(stat, canonicalRoot);

  if (root === undefined) {
    return false;
  }

  let current = canonicalPath;

  while (true) {
    const identity = await readIdentity(stat, current);

    if (identity !== undefined && identity.dev === root.dev && identity.ino === root.ino) {
      return true;
    }

    const parent = dirname(current);

    if (parent === current) {
      return false;
    }

    current = parent;
  }
}

// A path that is not there has no identity to match, so the walk climbs past it
// rather than treating it as an answer. Any other failure is the filesystem's own
// and is left to surface: swallowing it would report a refusal for what node
// blames on something else.
async function readIdentity(stat: Stat, path: string): Promise<PathIdentity | undefined> {
  try {
    const { dev, ino } = await stat(path);
    return { dev, ino };
  } catch (error) {
    if (MISSING_PATH_CODES.includes(getOwnErrorCode(error) ?? "")) {
      return undefined;
    }

    throw error;
  }
}

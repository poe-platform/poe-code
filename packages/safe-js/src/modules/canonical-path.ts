import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { getOwnErrorCode } from "../error-codes.js";

// realpath answers ENOENT for a missing segment and ENOTDIR when a parent is a
// file. Both mean the segment is not an existing directory, so both walk up.
const MISSING_PATH_CODES: readonly string[] = ["ENOENT", "ENOTDIR"];

// What the filesystem answers for a path that has no link target to follow: EINVAL
// for a path that exists and is not a link, and the missing-path codes for one that
// is not there at all. Any other failure is the filesystem's own and is left to
// surface rather than read as "not a link", which would canonicalize a link the
// filesystem merely refused to read as though it named itself.
const NOT_A_SYMLINK_CODES: readonly string[] = [...MISSING_PATH_CODES, "EINVAL"];

// A conforming realpath raises ELOOP for a cycle before the walk below can follow
// one, so this cap is only reached by a filesystem that reports a cycle as a
// missing path. Following one of those forever would hang the sandbox, so the walk
// gives up the way the platform does — at SYMLOOP_MAX, which is 32 on darwin and
// Linux alike.
const MAX_SYMLINK_FOLLOWS = 32;

type Realpath = (path: string) => Promise<string>;

// A symlink's target exactly as stored, which is how node keeps it: relative
// targets stay relative and resolve against the link's own directory.
type Readlink = (path: string) => Promise<string>;

// The filesystem operations canonicalization needs: what a path resolves to, and
// what a link it could not resolve names. Named as a whole because both are read
// together, off the same filesystem, to canonicalize one path.
export type CanonicalPathFs = { realpath: Realpath; readlink: Readlink };

// Which file a path names, as the filesystem itself answers it.
type PathIdentity = { dev: number; ino: number };

export type Stat = (path: string) => Promise<PathIdentity>;

// Canonicalizes as much of the path as exists and re-appends the segments that do
// not, so a path is checked after symlinks are followed rather than as written.
// The missing segments go back through resolve(), which collapses any `..` among
// them, so they cannot re-escape what realpath already pinned down.
//
// A dangling symlink is the case this cannot read off realpath alone: realpath
// refuses one with the same ENOENT it gives a path that was never there, yet the two
// are not the same place. node follows a dangling link and acts on its target — a
// write through one creates the target — so a dangling link canonicalizes to what it
// names, not to itself. Reading that ENOENT as "nothing here" would answer with the
// link's own path and call a link out of a caller's root contained.
export async function resolveCanonicalPath(
  { realpath, readlink }: CanonicalPathFs,
  path: string
): Promise<string> {
  const missingSegments: string[] = [];
  let current = path;
  let follows = 0;

  while (true) {
    try {
      const canonicalCurrent = await realpath(current);
      return resolve(canonicalCurrent, ...missingSegments.reverse());
    } catch (error) {
      if (!MISSING_PATH_CODES.includes(getOwnErrorCode(error) ?? "")) {
        throw error;
      }

      const target = await readSymlinkTarget(readlink, current);

      if (target !== undefined) {
        if (++follows > MAX_SYMLINK_FOLLOWS) {
          throw createLoopError(path);
        }

        // node resolves a relative target against the link's own directory. Any
        // segments already collected still hang off whatever the target resolves to,
        // so they stay on the list.
        current = isAbsolute(target) ? resolve(target) : resolve(dirname(current), target);
        continue;
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

// The target of a link realpath could not resolve, or undefined when the path is not
// a link at all and the walk should climb past it instead.
async function readSymlinkTarget(readlink: Readlink, path: string): Promise<string | undefined> {
  try {
    return await readlink(path);
  } catch (error) {
    if (NOT_A_SYMLINK_CODES.includes(getOwnErrorCode(error) ?? "")) {
      return undefined;
    }

    throw error;
  }
}

// Shaped like the ELOOP a filesystem raises for a cycle it walked itself, so a
// caller that branches on the code reads the cap and the filesystem's own answer the
// same way.
function createLoopError(path: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(
    `ELOOP: too many symbolic links encountered, realpath '${path}'`
  );

  error.code = "ELOOP";
  return error;
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

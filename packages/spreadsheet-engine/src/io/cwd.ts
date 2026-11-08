interface DirectoryStat {
  readonly type: string;
  readonly identityScope?: object | symbol | undefined;
  readonly dev?: number | undefined;
  readonly ino?: number | undefined;
  readonly opaqueIdentity?: string | undefined;
}

function snapshotDirectory(value: DirectoryStat): DirectoryStat {
  const { type, identityScope, dev, ino, opaqueIdentity } = value;
  return { type, identityScope, dev, ino, opaqueIdentity };
}
export interface WorkingDirectoryFileSystem {
  /** Follows symlinks; identity must describe the same backing namespace used by I/O. */
  stat?(path: string, options: { readonly signal: AbortSignal }): Promise<DirectoryStat>;
}

/** POSIX GLib prefers a PWD alias only when stat proves it is the actual cwd.
 * Resolve before creating the engine/resource binding; never consult the host OS.
 * This is an identity observation, not a namespace lease or containment check. */
export async function resolveVfsCwd(cwd: string, pwd: string | undefined,
  filesystem: WorkingDirectoryFileSystem, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (!cwd.startsWith("/") || cwd.includes("\0")) throw new TypeError("ssconvert cwd must be an absolute VFS path");
  if (!pwd?.startsWith("/") || pwd.includes("\0") || pwd === cwd || !filesystem.stat) return cwd;
  const stat = filesystem.stat.bind(filesystem);
  try {
    // Snapshot before the next host call can reuse/mutate its metadata object.
    const actual = snapshotDirectory(await stat(cwd, { signal }));
    signal.throwIfAborted();
    if (actual.type !== "directory" || !((typeof actual.identityScope === "object" && actual.identityScope !== null) ||
      typeof actual.identityScope === "symbol")) return cwd;
    const alias = snapshotDirectory(await stat(pwd, { signal }));
    signal.throwIfAborted();
    if (alias.type !== "directory" || actual.identityScope !== alias.identityScope) return cwd;
    const numeric = (value: DirectoryStat) => Number.isSafeInteger(value.dev) && value.dev! >= 0 &&
      Number.isSafeInteger(value.ino) && value.ino! >= 0;
    if (numeric(actual) && numeric(alias)) return actual.dev === alias.dev && actual.ino === alias.ino ? pwd : cwd;
    if (typeof actual.opaqueIdentity === "string" && actual.opaqueIdentity.length > 0 && actual.opaqueIdentity.length <= 4096 &&
      actual.opaqueIdentity === alias.opaqueIdentity) return pwd;
  } catch {
    signal.throwIfAborted();
    // Like failed native stat, unavailable identity leaves the actual cwd in use.
  }
  return cwd;
}

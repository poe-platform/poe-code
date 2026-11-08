import type { FileStagingEntry, FileStagingResolution, FileStat, PublishStagedFileOptions } from "../contracts/filesystem.js";
import { FsError, toFsError } from "../contracts/errors.js";
import { compareIdentity } from "./mount/identity.js";
import { normalizePath, validatePath } from "../contracts/virtual-path.js";

export function directoryAncestryPaths(directory: string): string[] {
  validatePath(directory);
  if (!directory.startsWith("/") || normalizePath(directory) !== directory) throw new FsError("EINVAL", { path: directory });
  let path = "";
  return ["/", ...directory.split("/").filter(Boolean).map(component => path += `/${component}`)];
}

export function snapshotDirectoryAncestry(ancestors: readonly FileStagingEntry[]): readonly FileStagingEntry[] {
  const entries = ancestors.map(entry => Object.freeze({ path: entry.path, stat: Object.freeze({ ...entry.stat }) }));
  const paths = directoryAncestryPaths(entries.at(-1)?.path ?? "");
  if (entries.length !== paths.length || entries.some((entry, index) => entry.path !== paths[index])) {
    throw new FsError("EINVAL", { message: "directory ancestry requires a complete ordered root-to-directory list" });
  }
  for (const entry of entries) {
    if (entry.stat.type !== "directory") throw new FsError("EINVAL", { path: entry.path });
    if (compareIdentity(entry.stat, entry.stat) !== "same") throw new FsError("ENOTSUP", { path: entry.path });
  }
  return Object.freeze(entries);
}

export function runStagingGuard(guard: () => true): void {
  const result: unknown = guard();
  if (result !== true) {
    // A void callback would accept async implementations. Require a literal
    // success value and observe a misdeclared asynchronous rejection.
    void Promise.resolve(result).catch(() => {});
    throw new FsError("ENOTSUP", { message: "staging validation must return true synchronously" });
  }
}

export function snapshotStagingResolution(resolution: FileStagingResolution): FileStagingResolution {
  const path = resolution.path;
  validatePath(path);
  const ancestors = snapshotDirectoryAncestry(resolution.ancestors);
  const validate = resolution.validate;
  if (normalizePath(path) !== path || !path.startsWith("/") || path === "/"
    || ancestors.at(-1)!.path !== (path.slice(0, path.lastIndexOf("/")) || "/")
    || typeof validate !== "function") throw new FsError("EINVAL", { path });
  const parent = Object.freeze({ ...resolution.parent });
  if (parent.type !== "directory") throw new FsError("EINVAL", { path });
  if (compareIdentity(parent, ancestors.at(-1)!.stat) !== "same") throw new FsError("ENOTSUP", { path });
  const supplied = resolution.destination;
  const destination = supplied === null ? null : Object.freeze({ ...supplied });
  const requireSnapshot = (stat: FileStat): void => {
    if (compareIdentity(stat, stat) !== "same" || stat.type !== "directory" && (!Number.isSafeInteger(stat.revision) || stat.revision! < 0)) {
      throw new FsError("ENOTSUP", { path });
    }
  };
  if (destination !== null) {
    if (destination.type !== "file") throw new FsError("EINVAL", { path });
    requireSnapshot(destination);
  }
  if (!resolution.traversed.length) throw new FsError("EINVAL", { path });
  if (resolution.traversed.length > 4096) throw new FsError("EFBIG", { path });
  let recordedUnits = 0;
  const traversed = resolution.traversed.map(entry => {
    const entryPath = entry.path, stat = Object.freeze({ ...entry.stat }), linkTarget = entry.linkTarget;
    validatePath(entryPath);
    if (!entryPath.startsWith("/") || normalizePath(entryPath) !== entryPath
      || !["directory", "file", "symlink"].includes(stat.type)
      || stat.type === "symlink" && typeof linkTarget !== "string"
      || stat.type !== "symlink" && linkTarget !== undefined) throw new FsError("EINVAL", { path: entryPath });
    requireSnapshot(stat);
    recordedUnits += entryPath.length + (linkTarget?.length ?? 0);
    if (recordedUnits > 1_048_576) throw new FsError("EFBIG", { path });
    return Object.freeze({ path: entryPath, stat, ...(linkTarget === undefined ? {} : { linkTarget }) });
  });
  return Object.freeze({ path, parent, destination, ancestors, traversed: Object.freeze(traversed), validate });
}


/** Diagnose failed admission against supplied receipts; this is never a commit
 * guard. Successful publication still requires the backend's atomic checks. */
export async function inspectStagingBindings(read: (path: string) => Promise<FileStat>, destination: string,
  options: PublishStagedFileOptions): Promise<void> {
  options.signal?.throwIfAborted();
  const ancestors = snapshotDirectoryAncestry(options.ancestors!);
  const parent = destination.slice(0, destination.lastIndexOf("/")) || "/";
  if (normalizePath(destination) !== destination || ancestors.at(-1)?.path !== parent) throw new FsError("EINVAL", { path: destination });
  const expected = options.destination === null ? null : { ...options.destination };
  if (expected !== null && (compareIdentity(expected, expected) !== "same"
    || expected.type === "file" && (!Number.isSafeInteger(expected.revision) || expected.revision! < 0))) throw new FsError("ENOTSUP", { path: destination });
  const entries = [...ancestors.map(entry => ({ ...entry, directory: true })), { path: destination, stat: expected, directory: false }];
  for (const entry of entries) {
    let current: FileStat;
    try { current = await read(entry.path); }
    catch (error) {
      options.signal?.throwIfAborted();
      const code = toFsError(error).code;
      if (code === "ENOENT" && entry.stat === null) continue;
      if (["ENOENT", "ENOTDIR", "ELOOP"].includes(code)) throw new FsError("EAGAIN", { path: entry.path, cause: error });
      throw error;
    }
    options.signal?.throwIfAborted();
    if (entry.stat === null || current.type !== entry.stat.type || compareIdentity(current, entry.stat) !== "same") throw new FsError("EAGAIN", { path: entry.path });
    if (!entry.directory && (["revision", "size", "mode", "nlink", "mtimeMs", "ctimeMs"] as const).some(field => current[field] !== entry.stat![field])) {
      throw new FsError("EAGAIN", { path: entry.path });
    }
  }
}

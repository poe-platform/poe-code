import type { FileStagingEntry, FileStat, PublishStagedFileOptions } from "../contracts/filesystem.js";
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

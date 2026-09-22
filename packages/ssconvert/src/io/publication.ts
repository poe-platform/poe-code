import { SsconvertError, type CapabilityContext, type FileOutput } from "../contracts.js";
import { ioFailure, FileWriteError } from "../io-errors.js";
import { resourceUri } from "../resource-uri.js";

interface Options { readonly signal?: AbortSignal }
interface Stat { readonly type: string; readonly mode: number }
/** Only explicitly supplied VFS operations; no host filesystem or ambient randomness. */
export interface PublicationFileSystem {
  readonly capabilities: Readonly<Record<string, boolean | undefined>>;
  capabilitiesFor?(path: string, options?: Options): Promise<Readonly<Record<string, boolean | undefined>>>;
  lstat(path: string, options?: Options): Promise<Stat>;
  access(path: string, mode?: number, options?: Options): Promise<void>;
  readlink?(path: string, options?: Options): Promise<string>;
  writeFile(path: string, bytes: Uint8Array, options?: Options & { readonly flag?: "w" | "wx"; readonly mode?: number }): Promise<void>;
  rename(source: string, destination: string, options?: Options): Promise<void>;
  unlink?(path: string, options?: Options): Promise<void>;
  chmod?(path: string, mode: number, options?: Options): Promise<void>;
}

/** libgsf stdio publication: exclusive same-directory temp, rename, then restore mode.
 * Error during publication deliberately keeps the temp; preceding write errors remove it. */
export function createVfsOutput(fs: PublicationFileSystem,
  writeBytes: (path: string, bytes: Uint8Array, signal: AbortSignal) => Promise<void>,
  retainCleanup?: (cleanup: (remove: (path: string) => Promise<void>) => Promise<void>) => () => Promise<void>) {
  let serial = 0;
  return async (filename: string, context: CapabilityContext): Promise<FileOutput> => {
    const signal = context.signal;
    const options = { signal };
    const uri = resourceUri(filename, context.environment.cwd ?? context.environment.env.PWD ?? "/");
    let path = filename;
    let temporary: string | undefined;
    let finalized = false;
    let aborting: Promise<void> | undefined;
    let closed = false;
    let releaseAcquisition!: () => void;
    const acquiring = new Promise<void>((resolve) => { releaseAcquisition = resolve; });
    const check = () => {
      signal.throwIfAborted();
      if (closed) throw new SsconvertError("invalid-request", "ssconvert file output is closed");
    };
    const abort = (remove = (path: string) => fs.unlink!(path)): Promise<void> => {
      closed = true;
      return (aborting ??= (async () => {
        // Ownership cleanup drains admitted acquisition before deciding which
        // temporary resource it must retire. It never borrows the abort signal.
        await acquiring;
        if (finalized || temporary === undefined) return;
        const path = temporary;
        temporary = undefined;
        await remove(path);
      })());
    };
    try {
      // Invocation-scoped hosts may require a separately retained cleanup
      // capability after their ordinary filesystem signal has been aborted.
      context.own(retainCleanup ? retainCleanup(abort) : abort);
      check();
      let mode = 0o666 & ~(context.environment.umask ?? 0o022);
      for (let links = 0; ; links++) {
        check();
        if (links > 40) throw new SsconvertError("resource-limit", "ssconvert output symlink limit exceeded");
        let stat: Stat;
        try { stat = await fs.lstat(path, options); }
        catch (error) {
          signal.throwIfAborted();
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") break;
          ioFailure(error, uri, "write", path);
        }
        check();
        if (stat.type === "symlink") {
          if (!fs.readlink) throw new SsconvertError("capability-denied", "Filesystem readlink capability is required for output aliases");
          const target = await fs.readlink(path, options);
          check();
          const dirname = path.slice(0, path.lastIndexOf("/") + 1);
          path = target.startsWith("/") ? target : dirname + target;
          continue;
        }
        if (stat.type !== "file") throw new FileWriteError(uri, `${path}: Is not a regular file`);
        try { await fs.access(path, 2, options); }
        catch (error) { signal.throwIfAborted(); ioFailure(error, uri, "write", path); }
        check();
        mode = stat.mode & 0o7777;
        break;
      }
      check();
      const capabilities = await fs.capabilitiesFor?.(path, options) ?? fs.capabilities;
      check();
      if (!capabilities.exclusiveCreate || !capabilities.atomicRename || !capabilities.permissions || !fs.unlink || !fs.chmod)
        throw new SsconvertError("capability-denied", "Filesystem exclusive creation, atomic rename, unlink and permissions capabilities are required for ssconvert file publication");
      const dirname = path.slice(0, path.lastIndexOf("/") + 1);
      const random = context.random?.next() ?? 0;
      if (!Number.isFinite(random) || random < 0 || random >= 1) throw new SsconvertError("invalid-request", "Invalid ssconvert random value");
      for (let attempt = 0; ; attempt++) {
        check();
        if (attempt >= Math.max(1, context.limits.operations)) throw new SsconvertError("resource-limit", "ssconvert temporary file collision limit exceeded");
        const suffix = ((Math.floor(random * 2176782336) + serial++) % 2176782336).toString(36).toUpperCase().padStart(6, "0");
        const candidate = `${dirname}.gsf-save-${suffix}`;
        try { await fs.writeFile(candidate, new Uint8Array(), { ...options, flag: "wx", mode: 0o600 }); }
        catch (error) {
          signal.throwIfAborted();
          if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") continue;
          ioFailure(error, uri, "write", candidate);
        }
        temporary = candidate;
        check();
        break;
      }
      return {
        abort,
        async write(bytes) {
          check();
          if (finalized || !temporary) throw new SsconvertError("invalid-request", "ssconvert file output is closed");
          try { await writeBytes(temporary, bytes, signal); }
          catch (error) {
            signal.throwIfAborted();
            await abort();
            if (error && typeof error === "object" && "code" in error && error.code === "ENOSPC") {
              await context.diagnostic?.({ code: "close-error", severity: "error", message: "  ==> Failed to close file: No space left on device" });
              throw new SsconvertError("io", "E Failed to close file: No space left on device");
            }
            throw error;
          }
        },
        async close() {
          check();
          if (finalized || !temporary) throw new SsconvertError("invalid-request", "ssconvert file output is closed");
          // From this point, failed rename leaves the complete private temp in place.
          finalized = true;
          try { await fs.rename(temporary, path, options); }
          catch (error) {
            signal.throwIfAborted();
            if (error && typeof error === "object" && "code" in error && error.code === "EACCES") {
              await context.diagnostic?.({ code: "publication-error", severity: "error", message: "  ==> Permission denied" });
              throw new SsconvertError("io", "E Permission denied");
            }
            throw error;
          }
          temporary = undefined;
          try { await fs.chmod!(path, mode, options); }
          catch (error) {
            signal.throwIfAborted();
            // Native libgsf ignores this post-publication permission failure.
            // Preserve unmeasured opaque host failures rather than inventing parity.
            if (error && typeof error === "object" && "code" in error && error.code === "EACCES") return;
            throw error;
          }
        }
      };
    } finally { releaseAcquisition(); }
  };
}

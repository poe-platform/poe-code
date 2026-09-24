import type { CreateStagedFileOptions, FileStagingCleanup, FsOptions } from "../contracts/filesystem.js";
import { FsError } from "../contracts/errors.js";
import { finishCleanup } from "../contracts/cleanup.js";

/** Capture creation controls before awaits or allocation can split their meaning. */
export function snapshotStagingCreation(options: CreateStagedFileOptions, path: string): CreateStagedFileOptions {
  const { signal, retainCleanup, parent, mode, atimeMs, mtimeMs, ...extra } = options;
  signal?.throwIfAborted();
  if (retainCleanup !== undefined && typeof retainCleanup !== "boolean") throw new FsError("EINVAL", { syscall: "createStagedFile", path });
  return {
    ...extra, parent,
    ...(signal === undefined ? {} : { signal }),
    ...(retainCleanup === undefined ? {} : { retainCleanup }),
    ...(mode === undefined ? {} : { mode }),
    ...(atimeMs === undefined ? {} : { atimeMs }),
    ...(mtimeMs === undefined ? {} : { mtimeMs }),
  };
}

/** Own admission and release outside wrappers that can fail before dispatch. */
export function createStagingCleanup(path: string, remove: (options: FsOptions) => void | Promise<void>,
  release: () => void | Promise<void>): FileStagingCleanup {
  let accepting = true;
  let removal: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let released: Promise<void> | undefined;
  const dispose = (): Promise<void> => released ??= Promise.resolve().then(release);
  return Object.freeze({
    remove(options: FsOptions = {}): Promise<void> {
      if (removal) return removal;
      if (!accepting) {
        const rejected = Promise.reject(new FsError("EBADF", { syscall: "removeStagedFile", path }));
        void rejected.catch(() => {});
        return rejected;
      }
      accepting = false;
      removal = Promise.resolve().then(async () => {
        let failed = true;
        try { await remove(options); failed = false; }
        finally { await finishCleanup(dispose, failed); }
      });
      void removal.catch(() => {});
      return removal;
    },
    close(): Promise<void> {
      accepting = false;
      closing ??= (async () => {
        await removal?.catch(() => {});
        await dispose();
      })();
      void closing.catch(() => {});
      return closing;
    },
  });
}

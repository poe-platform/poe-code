import type { FsOptions, FileReadHandle, FileResizeHandle, FileSystem, FileSystemCapabilities, OpenReadFileOptions, OpenResizeFileOptions } from "../contracts/filesystem.js";
import { FsError } from "../contracts/errors.js";
import { finishCleanup } from "../contracts/cleanup.js";

export function retainedReadCapabilities(filesystem: FileSystem, capabilities = filesystem.capabilities): FileSystemCapabilities {
  return typeof filesystem.openReadFile === "function" ? capabilities : { ...capabilities, retainedRead: false };
}

export async function openRetainedReadFile(filesystem: FileSystem, path: string, options: OpenReadFileOptions): Promise<FileReadHandle> {
  const signal = options.signal;
  let handle: FileReadHandle | undefined;
  try {
    signal?.throwIfAborted();
    const available = typeof filesystem.openReadFile === "function";
    signal?.throwIfAborted();
    if (!available) throw new FsError("ENOTSUP", { syscall: "openReadFile", path });
    const query = filesystem.capabilitiesFor;
    signal?.throwIfAborted();
    const metadata = Promise.resolve(query == null ? undefined : Reflect.apply(query, filesystem, [path, options]));
    const queried = await (signal ? new Promise<FileSystemCapabilities | undefined>((resolve, reject) => {
      const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      metadata.then(
        value => { signal.removeEventListener("abort", abort); resolve(value); },
        error => { signal.removeEventListener("abort", abort); reject(error); },
      );
      if (signal.aborted) abort();
    }) : metadata);
    signal?.throwIfAborted();
    const capabilities = queried ?? filesystem.capabilities;
    signal?.throwIfAborted();
    const supported = capabilities.retainedRead;
    signal?.throwIfAborted();
    if (supported !== true) throw new FsError("ENOTSUP", { syscall: "openReadFile", path });
    const acquire = filesystem.openReadFile;
    signal?.throwIfAborted();
    if (typeof acquire !== "function") throw new FsError("ENOTSUP", { syscall: "openReadFile", path });
    handle = await Reflect.apply(acquire, filesystem, [path, options]);
    signal?.throwIfAborted();
    return handle;
  } catch (error) {
    if (handle) await finishCleanup(() => handle!.close(), true);
    signal?.throwIfAborted();
    throw error;
  }
}

export function requireCapabilities(...values: readonly (boolean | undefined)[]): boolean | undefined {
  return values.some(value => value === false) ? false : values.every(value => value === true) ? true : undefined;
}

export function retainedResizeCapabilities(filesystem: FileSystem, capabilities = filesystem.capabilities): FileSystemCapabilities {
  if (capabilities.retainedResize !== true) return capabilities;
  return typeof filesystem.openResizeFile === "function" && capabilities.readOnly !== true
    ? capabilities : { ...capabilities, retainedResize: false };
}

export async function openRetainedResizeFile(filesystem: FileSystem, path: string, options: OpenResizeFileOptions): Promise<FileResizeHandle> {
  const signal = options.signal;
  let handle: FileResizeHandle | undefined;
  try {
    signal?.throwIfAborted();
    const available = typeof filesystem.openResizeFile === "function";
    signal?.throwIfAborted();
    if (!available) throw new FsError("ENOTSUP", { syscall: "openResizeFile", path });
    const query = filesystem.capabilitiesFor;
    signal?.throwIfAborted();
    const intent = { ...(signal === undefined ? {} : { signal }), create: options.create === true };
    signal?.throwIfAborted();
    const metadata = Promise.resolve(query === undefined ? filesystem.capabilities : Reflect.apply(query, filesystem, [path, intent]));
    const capabilities = await (signal ? new Promise<FileSystemCapabilities>((resolve, reject) => {
      const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      metadata.then(
        value => { signal.removeEventListener("abort", abort); resolve(value); },
        error => { signal.removeEventListener("abort", abort); reject(error); },
      );
      if (signal.aborted) abort();
    }) : metadata);
    signal?.throwIfAborted();
    const readOnly = capabilities.readOnly;
    signal?.throwIfAborted();
    if (readOnly === true) throw new FsError("EROFS", { syscall: "openResizeFile", path });
    const supported = capabilities.retainedResize;
    signal?.throwIfAborted();
    if (supported !== true) throw new FsError("ENOTSUP", { syscall: "openResizeFile", path });
    const acquire = filesystem.openResizeFile;
    signal?.throwIfAborted();
    if (typeof acquire !== "function") throw new FsError("ENOTSUP", { syscall: "openResizeFile", path });
    handle = await Reflect.apply(acquire, filesystem, [path, options]);
    signal?.throwIfAborted();
    return handle;
  } catch (error) {
    if (handle) await finishCleanup(() => handle!.close(), true);
    signal?.throwIfAborted();
    throw error;
  }
}

export function readOnlyCapabilities(capabilities: FileSystemCapabilities): FileSystemCapabilities {
  const inspection = Object.fromEntries([
    "read", "stat", "readdir", "realpath", "access", "readlink", "explicitDirectories", "implicitDirectories",
    "symlinks", "streamingRead", "retainedRead",
  ].filter(name => capabilities[name] !== undefined).map(name => [name, capabilities[name]]));
  return Object.freeze({
    ...inspection, readOnly: true, write: false, append: false, exclusiveCreate: false,
    mkdir: false, recursiveMkdir: false, remove: false, removeDirectory: false, recursiveRemove: false,
    rename: false, copy: false, exclusiveCopy: false, truncate: false, streamingAppend: false,
    randomAccessWrite: false, hardlinks: false, permissions: false, timestamps: false,
    descriptorWriteStream: false, atomicResize: false, retainedResize: false, atomicFileMutation: false, atomicFileStaging: false, atomicDirectoryMetadata: false,
    atomicRename: false, atomicRenameNoReplace: false, streamingWrite: false,
  });
}

export function quotaCapabilities(capabilities: FileSystemCapabilities): FileSystemCapabilities {
  const streamingWrite = requireCapabilities(capabilities.write, capabilities.append, !capabilities.readOnly);
  const streamingAppend = requireCapabilities(capabilities.append, !capabilities.readOnly);
  const { streamingWrite: ignoredWrite, streamingAppend: ignoredAppend, ...rest } = capabilities;
  return Object.freeze({ ...rest, descriptorWriteStream: false, atomicResize: false, atomicFileMutation: false, atomicFileStaging: false, atomicDirectoryMetadata: false,
    ...(streamingWrite === undefined ? {} : { streamingWrite }),
    ...(streamingAppend === undefined ? {} : { streamingAppend }),
  });
}

export function ownedMutationCapabilities(filesystem: FileSystem, capabilities = filesystem.capabilities): FileSystemCapabilities {
  const unavailable: Record<string, false> = {};
  if (capabilities.atomicFileMutation === true && (capabilities.readOnly === true || typeof filesystem.writeFileConditional !== "function" || typeof filesystem.removeFileConditional !== "function")) unavailable.atomicFileMutation = false;
  if (capabilities.atomicFileStaging === true && (capabilities.readOnly === true
    || typeof filesystem.createStagedFile !== "function" || typeof filesystem.publishStagedFile !== "function" || typeof filesystem.removeStagedFile !== "function")) unavailable.atomicFileStaging = false;
  if (capabilities.atomicDirectoryMetadata === true && (capabilities.readOnly === true || typeof filesystem.prepareDirectory !== "function")) unavailable.atomicDirectoryMetadata = false;
  return Object.keys(unavailable).length ? { ...capabilities, ...unavailable } : capabilities;
}

export async function requireOwnedMutation(filesystem: FileSystem, path: string,
  capability: "atomicFileMutation" | "atomicFileStaging" | "atomicDirectoryMetadata", options: FsOptions): Promise<void> {
  options.signal?.throwIfAborted();
  const capabilities = ownedMutationCapabilities(filesystem, await filesystem.capabilitiesFor?.(path, options) ?? filesystem.capabilities);
  options.signal?.throwIfAborted();
  if (capabilities[capability] !== true) throw new FsError("ENOTSUP", { path, syscall: capability });
}

import type { FileReadHandle, FileSystem, FileSystemCapabilities, FsOptions } from "../contracts/filesystem.js";
import { FsError } from "../contracts/errors.js";
import { finishCleanup } from "../contracts/cleanup.js";

export function retainedReadCapabilities(filesystem: FileSystem, capabilities = filesystem.capabilities): FileSystemCapabilities {
  return typeof filesystem.openReadFile === "function" ? capabilities : { ...capabilities, retainedRead: false };
}

export async function openRetainedReadFile(filesystem: FileSystem, path: string, options: FsOptions): Promise<FileReadHandle> {
  let handle: FileReadHandle | undefined;
  try {
    options.signal?.throwIfAborted();
    if (typeof filesystem.openReadFile !== "function") throw new FsError("ENOTSUP", { syscall: "openReadFile", path });
    const capabilities = await filesystem.capabilitiesFor?.(path, options) ?? filesystem.capabilities;
    options.signal?.throwIfAborted();
    if (retainedReadCapabilities(filesystem, capabilities).retainedRead !== true) throw new FsError("ENOTSUP", { syscall: "openReadFile", path });
    handle = await filesystem.openReadFile!(path, options);
    options.signal?.throwIfAborted();
    return handle;
  } catch (error) {
    if (handle) await finishCleanup(() => handle!.close(), true);
    options.signal?.throwIfAborted();
    throw error;
  }
}

export function requireCapabilities(...values: readonly (boolean | undefined)[]): boolean | undefined {
  return values.some(value => value === false) ? false : values.every(value => value === true) ? true : undefined;
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
    descriptorWriteStream: false,
    atomicRename: false, streamingWrite: false,
  });
}

export function quotaCapabilities(capabilities: FileSystemCapabilities): FileSystemCapabilities {
  const streamingWrite = requireCapabilities(capabilities.write, capabilities.append, !capabilities.readOnly);
  const streamingAppend = requireCapabilities(capabilities.append, !capabilities.readOnly);
  const { streamingWrite: ignoredWrite, streamingAppend: ignoredAppend, ...rest } = capabilities;
  return Object.freeze({ ...rest, descriptorWriteStream: false,
    ...(streamingWrite === undefined ? {} : { streamingWrite }),
    ...(streamingAppend === undefined ? {} : { streamingAppend }),
  });
}

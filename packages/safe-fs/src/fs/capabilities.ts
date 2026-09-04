import type { FileSystemCapabilities } from "../contracts/filesystem.js";

export function requireCapabilities(...values: readonly (boolean | undefined)[]): boolean | undefined {
  return values.some(value => value === false) ? false : values.every(value => value === true) ? true : undefined;
}

export function readOnlyCapabilities(capabilities: FileSystemCapabilities): FileSystemCapabilities {
  const inspection = Object.fromEntries([
    "read", "stat", "readdir", "realpath", "access", "readlink", "explicitDirectories", "implicitDirectories",
    "symlinks", "streamingRead",
  ].filter(name => capabilities[name] !== undefined).map(name => [name, capabilities[name]]));
  return Object.freeze({
    ...inspection, readOnly: true, write: false, append: false, exclusiveCreate: false,
    mkdir: false, recursiveMkdir: false, remove: false, removeDirectory: false, recursiveRemove: false,
    rename: false, copy: false, exclusiveCopy: false, truncate: false, streamingAppend: false,
    randomAccessWrite: false, hardlinks: false, permissions: false, timestamps: false,
    atomicRename: false, streamingWrite: false,
  });
}

export function quotaCapabilities(capabilities: FileSystemCapabilities): FileSystemCapabilities {
  const streamingWrite = requireCapabilities(capabilities.write, capabilities.append, !capabilities.readOnly);
  const streamingAppend = requireCapabilities(capabilities.append, !capabilities.readOnly);
  const { streamingWrite: ignoredWrite, streamingAppend: ignoredAppend, ...rest } = capabilities;
  return Object.freeze({ ...rest,
    ...(streamingWrite === undefined ? {} : { streamingWrite }),
    ...(streamingAppend === undefined ? {} : { streamingAppend }),
  });
}

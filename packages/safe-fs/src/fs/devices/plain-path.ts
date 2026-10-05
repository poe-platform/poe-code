import type { FileSystem, FsOptions } from "../../contracts/filesystem.js";

// Private backend hooks, not cached path observations. A hook may only accept
// an ordinary existing path after freshly checking every component for symlinks.
export const plainDevicePathResolvers = new WeakMap<FileSystem, (path: string, options: FsOptions) => Promise<string | undefined>>();

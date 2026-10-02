export * from "./contracts/errors.js";
export * from "./contracts/filesystem.js";
export * from "./contracts/io.js";
export { openFileDescriptor } from "./fs/descriptor.js";
export type { DescriptorBackend, DescriptorOpenOptions } from "./fs/descriptor.js";
export {
  assertPathWithin, isPathWithin, normalizePath, relativePath, resolvePath, validatePath
} from "./contracts/virtual-path.js";
export { basename, dirname, extname, isAbsolutePath, joinPath, posixPath } from "./contracts/portable-path.js";
export * from "./fs/memory/index.js";
export * from "./fs/devices/index.js";
export { retargetScopedFileSystem, scopeFileSystem, retainFileSystemCleanup } from "./fs/scoped.js";
export type { RetainedFileSystemCleanupView, RetainedFileSystemCleanupOptions } from "./fs/scoped.js";
export { compareEntries, registerEntryView } from "./fs/mount/comparison.js";
export type { EntryViewResolver } from "./fs/mount/comparison.js";
export { bindConditionalMutation, type ConditionalMutationBinding } from "./fs/memory/index.js";

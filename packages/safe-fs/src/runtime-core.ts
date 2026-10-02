export * from "./contracts/errors.js";
export * from "./contracts/filesystem.js";
export * from "./contracts/io.js";
export { compareIdentity, compareFileVersion } from "./fs/mount/identity.js";
export { openFileDescriptor } from "./fs/descriptor.js";
export type { DescriptorBackend, DescriptorOpenOptions } from "./fs/descriptor.js";
export {
  assertPathWithin, isPathWithin, normalizePath, relativePath, resolvePath, validatePath
} from "./contracts/virtual-path.js";
export { basename, dirname, extname, isAbsolutePath, joinPath, posixPath } from "./contracts/portable-path.js";
import type { FileSystem } from "./contracts/filesystem.js";
export type { MemoryFileSystem, MemoryFileSystemLimits, MemoryFileSystemOptions, MemoryRedirectHandle } from "./fs/memory/index.js";
const _getMemHooks = (): any => (globalThis as any).__safeBashMemHooks;
export function isUnmodifiedMemoryFileSystem(fs: FileSystem): boolean {
  const proto = Object.getPrototypeOf(fs);
  if (!proto || !_getMemHooks()?.protos?.has(proto)) return false;
  return Object.getOwnPropertyNames(fs).every(name => {
    const method = Object.getOwnPropertyDescriptor(proto, name)?.value;
    return typeof method !== "function" || Object.getOwnPropertyDescriptor(fs, name)?.value === method;
  }) && Object.getOwnPropertyNames(proto).every(name => {
    const method = Object.getOwnPropertyDescriptor(proto, name)?.value;
    return typeof method !== "function" || Reflect.get(fs, name) === method;
  });
}
export function isCleanAbsolutePath(p: string): boolean {
  const fn = _getMemHooks()?.isCleanAbsolutePath;
  if (fn) return fn(p);
  return p.length > 0 && p.charCodeAt(0) === 47 && !p.includes("//") && !p.includes("/.") && (p.length === 1 || p.charCodeAt(p.length - 1) !== 47);
}
export function tryGetMemoryDirectoryEntryNamesSync(fs: FileSystem, path: string): any {
  return (fs && _getMemHooks()?.byProto?.get(Object.getPrototypeOf(fs))?.tryGetMemoryDirectoryEntryNamesSync)?.(fs, path);
}
export function tryReadMemoryFileViewSync(fs: FileSystem, path: string, maxBytes?: number, signal?: AbortSignal, captureSourceRef?: boolean, beforeRead?: () => void): Uint8Array | undefined {
  return (fs && _getMemHooks()?.byProto?.get(Object.getPrototypeOf(fs))?.tryReadMemoryFileViewSync)?.(fs, path, maxBytes, signal, captureSourceRef, beforeRead);
}
export function tryResolveMemoryDevicePath(fs: FileSystem, path: string, followFinal?: boolean): string | undefined {
  return (fs && _getMemHooks()?.byProto?.get(Object.getPrototypeOf(fs))?.tryResolveMemoryDevicePath)?.(fs, path, followFinal);
}
export * from "./fs/devices/index.js";
export { retargetScopedFileSystem, scopeFileSystem, retainFileSystemCleanup } from "./fs/scoped.js";
export type { RetainedFileSystemCleanupView, RetainedFileSystemCleanupOptions } from "./fs/scoped.js";
export { compareEntries, registerEntryView } from "./fs/mount/comparison.js";
export type { EntryViewResolver } from "./fs/mount/comparison.js";
export type { ConditionalMutationBinding } from "./fs/memory/index.js";
export async function bindConditionalMutation<Result>(identityScope: object | symbol | undefined, binding: any, action: () => Promise<Result>): Promise<Result> {
  const fn = _getMemHooks()?.bindConditionalMutation;
  return fn ? fn(identityScope, binding, action) : action();
}

export function tryOpenMemoryRedirectHandleSync(fs: FileSystem, path: string, append: boolean, mode: number, signal?: AbortSignal): any {
  return (fs && _getMemHooks()?.byProto?.get(Object.getPrototypeOf(fs))?.tryOpenMemoryRedirectHandleSync)?.(fs, path, append, mode, signal);
}
export function tryWriteMemoryFileSync(fs: FileSystem, path: string, data: Uint8Array, append: boolean, mode: number, signal?: AbortSignal): boolean {
  return Boolean((fs && _getMemHooks()?.byProto?.get(Object.getPrototypeOf(fs))?.tryWriteMemoryFileSync)?.(fs, path, data, append, mode, signal));
}
export function tryMkdirMemorySync(fs: FileSystem, path: string, recursive: boolean, mode: number, signal?: AbortSignal, dirPrefixHint?: string): boolean {
  return Boolean((fs && _getMemHooks()?.byProto?.get(Object.getPrototypeOf(fs))?.tryMkdirMemorySync)?.(fs, path, recursive, mode, signal, dirPrefixHint));
}
export function tryRmRfMemorySync(fs: FileSystem, path: string, signal?: AbortSignal): boolean {
  return Boolean((fs && _getMemHooks()?.byProto?.get(Object.getPrototypeOf(fs))?.tryRmRfMemorySync)?.(fs, path, signal));
}
export function tryWriteMemoryFileInDirSync(fs: FileSystem, dirPrefix: string, name: string, data: Uint8Array, append: boolean, mode: number, signal?: AbortSignal): boolean {
  return Boolean((fs && _getMemHooks()?.byProto?.get(Object.getPrototypeOf(fs))?.tryWriteMemoryFileInDirSync)?.(fs, dirPrefix, name, data, append, mode, signal));
}

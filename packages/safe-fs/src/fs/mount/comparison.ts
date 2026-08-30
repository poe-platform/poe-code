import { comparisonContext, platform } from "#safe-fs-platform";
import { FsError } from "../../contracts/errors.js";
import type { EntryComparison, FileStat, FileSystem, FsOptions } from "../../contracts/filesystem.js";
import { compareIdentity } from "./identity.js";

export interface EntryLocation {
  readonly filesystem: FileSystem;
  readonly path: string;
  readonly readOnly?: boolean;
  readonly stat?: FileStat;
}

export interface EntryView extends EntryLocation {
  readonly stat: FileStat;
  readonly readOnly: boolean;
}

export type EntryViewResolver = (path: string, options: FsOptions) => Promise<EntryLocation>;
export type EntryAuthority = (own: EntryView, peer: EntryView, options: FsOptions) => Promise<EntryComparison>;

const resolvers = new WeakMap<FileSystem, EntryViewResolver>();
const authorities = new WeakMap<FileSystem, EntryAuthority>();
export function assertCallbackAuthorityAllowed(): void {
  if (!platform.callbackAuthorities) throw new FsError("ENOTSUP", { message: "custom comparison authorities require Node context" });
}

export function registerEntryView(filesystem: FileSystem, resolver: EntryViewResolver): void {
  if (resolvers.has(filesystem)) throw new TypeError("entry view already registered");
  resolvers.set(filesystem, resolver);
}

export function registerEntryAuthority(filesystem: FileSystem, authority: EntryAuthority): void {
  if (authorities.has(filesystem)) throw new TypeError("entry authority already registered");
  authorities.set(filesystem, authority);
}

export async function resolveEntryView(filesystem: FileSystem, path: string, options: FsOptions = {}): Promise<EntryView> {
  let location: EntryLocation = { filesystem, path };
  let readOnly = false;
  const visited = new Set<FileSystem>();
  for (;;) {
    options.signal?.throwIfAborted();
    if (visited.has(location.filesystem)) throw new FsError("EIO", { path, message: "cyclic entry view" });
    visited.add(location.filesystem);
    readOnly ||= location.readOnly === true || location.filesystem.capabilities.readOnly === true;
    if (location.stat) return { filesystem: location.filesystem, path: location.path, stat: location.stat, readOnly };
    const resolve = resolvers.get(location.filesystem);
    if (!resolve) {
      let stat: FileStat;
      let followedPath: string;
      try {
        followedPath = await location.filesystem.realpath(location.path, options);
        options.signal?.throwIfAborted();
        stat = await location.filesystem.lstat(followedPath, options);
      }
      catch (error) { options.signal?.throwIfAborted(); throw error; }
      options.signal?.throwIfAborted();
      if (stat.type === "symlink") throw new FsError("EIO", { path, message: "followed entry changed during observation" });
      return { filesystem: location.filesystem, path: followedPath, stat, readOnly };
    }
    let next: EntryLocation;
    try { next = await resolve(location.path, options); }
    catch (error) { options.signal?.throwIfAborted(); throw error; }
    options.signal?.throwIfAborted();
    if (next.filesystem === location.filesystem && next.stat) {
      return { filesystem: next.filesystem, path: next.path, stat: next.stat, readOnly: readOnly || next.readOnly === true };
    }
    location = next;
  }
}

export async function compareResolvedEntries(own: EntryView, peer: EntryView, options: FsOptions = {}): Promise<EntryComparison> {
  options.signal?.throwIfAborted();
  if (comparisonContext.active(options)) return "unknown";
  const identity = compareIdentity(own.stat, peer.stat);
  if (identity !== "unknown") return identity;
  return comparisonContext.run(options, async (options) => {
    const queried = new Set<EntryAuthority | FileSystem>();
    let result: EntryComparison = "unknown";
    for (const [left, right] of [[own, peer], [peer, own]] as const) {
      options.signal?.throwIfAborted();
      const authority = authorities.get(left.filesystem);
      const key = authority ?? left.filesystem;
      if (queried.has(key)) continue;
      queried.add(key);
      let answer: EntryComparison;
      try {
        if (authority) answer = await authority(left, right, options);
        else if (left.filesystem.compareEntry) {
          assertCallbackAuthorityAllowed();
          answer = await left.filesystem.compareEntry(left.path, right.filesystem, right.path, options);
        }
        else continue;
      } catch (error) {
        options.signal?.throwIfAborted();
        throw error;
      }
      options.signal?.throwIfAborted();
      if (answer !== "same" && answer !== "distinct" && answer !== "unknown") {
        throw new FsError("EIO", { path: own.path, dest: peer.path, message: "invalid entry comparison answer" });
      }
      if (answer === "unknown") continue;
      if (result !== "unknown" && result !== answer) {
        throw new FsError("EIO", { path: own.path, dest: peer.path, message: "conflicting entry comparison answers" });
      }
      result = answer;
    }
    return result;
  });
}

export async function compareEntries(
  filesystem: FileSystem, path: string, peer: FileSystem, peerPath: string, options: FsOptions = {},
): Promise<EntryComparison> {
  options.signal?.throwIfAborted();
  if (comparisonContext.active(options)) return "unknown";
  const own = await resolveEntryView(filesystem, path, options);
  const other = await resolveEntryView(peer, peerPath, options);
  return compareResolvedEntries(own, other, options);
}

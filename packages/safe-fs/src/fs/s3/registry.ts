import { FsError } from "../../contracts/errors.js";
import type { FileStat, FileSystem, FsOptions, EntryComparison } from "../../contracts/filesystem.js";
import type { EntryView } from "../mount/comparison.js";
import { assertCallbackAuthorityAllowed } from "../mount/comparison.js";

export interface OwnedS3Entry {
  readonly storage: object;
  readonly key: string;
}

const observedStats = new WeakMap<FileStat, { filesystem: FileSystem; path: string; entry: OwnedS3Entry }>();
const entries = new WeakMap<FileSystem, (view: EntryView) => OwnedS3Entry | undefined>();
const comparisons = new WeakMap<FileSystem, NonNullable<FileSystem["compareEntry"]>>();
const configuredComparisons = new WeakMap<FileSystem, NonNullable<FileSystem["compareEntry"]>>();

export function recordS3Observation(filesystem: FileSystem, path: string, stat: FileStat, entry: OwnedS3Entry): void {
  observedStats.set(stat, { filesystem, path, entry });
}

export function registerS3EntryOwner(filesystem: FileSystem, normalize: (path: string) => string,
  intact: () => boolean, baseComparison: NonNullable<FileSystem["compareEntry"]>, comparison?: NonNullable<FileSystem["compareEntry"]>): void {
  comparisons.set(filesystem, baseComparison);
  if (comparison) configuredComparisons.set(filesystem, comparison);
  entries.set(filesystem, view => {
    if (!intact()) return undefined;
    const observation = observedStats.get(view.stat);
    return observation?.filesystem === filesystem && observation.path === normalize(view.path) ? observation.entry : undefined;
  });
}

export function getOwnedS3Entry(view: EntryView): OwnedS3Entry | undefined {
  return entries.get(view.filesystem)?.(view);
}

export async function compareOwnedS3Entries(own: EntryView, peer: EntryView, options: FsOptions): Promise<EntryComparison> {
  options.signal?.throwIfAborted();
  let explicit = false;
  let answer: EntryComparison = "unknown";
  const visited = new Set<FileSystem>();
  for (const [left, right] of [[own, peer], [peer, own]] as const) {
    const baseComparison = comparisons.get(left.filesystem);
    if (!baseComparison || visited.has(left.filesystem)) continue;
    visited.add(left.filesystem);
    const current = left.filesystem.compareEntry;
    const comparison = current === baseComparison ? configuredComparisons.get(left.filesystem) : current;
    if (current === baseComparison && comparison === undefined) continue;
    explicit = true;
    if (comparison === undefined) continue;
    options.signal?.throwIfAborted();
    if (typeof comparison !== "function") {
      throw new FsError("EIO", { path: own.path, dest: peer.path, message: "invalid explicit S3 comparison method" });
    }
    assertCallbackAuthorityAllowed();
    const result = await comparison.call(left.filesystem, left.path, right.filesystem, right.path, options);
    options.signal?.throwIfAborted();
    if (result !== "same" && result !== "distinct" && result !== "unknown") {
      throw new FsError("EIO", { path: own.path, dest: peer.path, message: "invalid explicit S3 comparison" });
    }
    if (result === "unknown") continue;
    if (answer !== "unknown" && answer !== result) {
      throw new FsError("EIO", { path: own.path, dest: peer.path, message: "conflicting explicit S3 comparisons" });
    }
    answer = result;
  }
  const left = getOwnedS3Entry(own);
  options.signal?.throwIfAborted();
  const right = getOwnedS3Entry(peer);
  options.signal?.throwIfAborted();
  const same = left && right && left.storage === right.storage && left.key === right.key;
  if (same && answer === "distinct") {
    throw new FsError("EIO", { path: own.path, dest: peer.path, message: "explicit S3 comparison contradicts a known alias" });
  }
  if (same) return "same";
  if (explicit) return answer;
  return left && right ? "distinct" : "unknown";
}

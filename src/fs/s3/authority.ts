import { AsyncLocalStorage } from "node:async_hooks";
import { FsError } from "../../contracts/errors.js";
import type { EntryComparison, FileStat, FileSystem, FsOptions } from "../../contracts/filesystem.js";
import type { EntryView } from "../mount/comparison.js";
import type { S3HeadOutput, S3ObjectInput } from "./transport.js";

export interface OwnedS3Entry {
  readonly storage: object;
  readonly key: string;
}

interface HeadProof {
  readonly query: S3ObjectInput;
  readonly entry: OwnedS3Entry;
}

const queries = new AsyncLocalStorage<S3ObjectInput>();
const providerHeads = new WeakMap<S3HeadOutput, HeadProof>();
const acceptedHeads = new WeakMap<S3HeadOutput, OwnedS3Entry>();
const observedStats = new WeakMap<FileStat, { filesystem: FileSystem; path: string; entry: OwnedS3Entry }>();
const entries = new WeakMap<FileSystem, (view: EntryView) => OwnedS3Entry | undefined>();
const comparisons = new WeakMap<FileSystem, NonNullable<FileSystem["compareEntry"]>>();
const configuredComparisons = new WeakMap<FileSystem, NonNullable<FileSystem["compareEntry"]>>();

export function recordMockS3Head(output: S3HeadOutput, input: S3ObjectInput, storage: object): void {
  const query = queries.getStore();
  if (query && query.Bucket === input.Bucket && query.Key === input.Key) {
    providerHeads.set(output, { query, entry: { storage, key: input.Key } });
  }
}

export async function queryS3Head(input: S3ObjectInput, action: () => Promise<S3HeadOutput>): Promise<S3HeadOutput> {
  const query = { ...input };
  return queries.run(query, async () => {
    const output = await action();
    acceptedHeads.delete(output);
    const proof = providerHeads.get(output);
    if (proof?.query === query) acceptedHeads.set(output, proof.entry);
    return output;
  });
}

export function recordS3Stat(filesystem: FileSystem, path: string, stat: FileStat, metadata: S3HeadOutput | undefined): void {
  if (!metadata) return;
  const entry = acceptedHeads.get(metadata);
  acceptedHeads.delete(metadata);
  if (entry) observedStats.set(stat, { filesystem, path, entry });
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

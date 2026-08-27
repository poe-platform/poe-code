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
  intact: () => boolean, baseComparison: NonNullable<FileSystem["compareEntry"]>): void {
  comparisons.set(filesystem, baseComparison);
  const names = ["stat", "lstat", "realpath", "readFile", "writeFile", "copyFile", "rename", "readStream", "writeStream"] as const;
  const methods = names.map(name => filesystem[name]);
  entries.set(filesystem, view => {
    if (!intact() || !names.every((name, index) => filesystem[name] === methods[index])) return undefined;
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
    const comparison = left.filesystem.compareEntry;
    if (comparison === baseComparison) continue;
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
  if (explicit) return answer;
  const left = getOwnedS3Entry(own);
  options.signal?.throwIfAborted();
  const right = getOwnedS3Entry(peer);
  options.signal?.throwIfAborted();
  if (!left || !right) return "unknown";
  return left.storage === right.storage && left.key === right.key ? "same" : "distinct";
}

import { AsyncLocalStorage } from "node:async_hooks";
import type { EntryComparison, FileStat, FileSystem, FsOptions } from "../../contracts/filesystem.js";
import type { EntryView } from "../mount/comparison.js";
import type { S3Client, S3HeadOutput, S3ObjectInput } from "./transport.js";

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
interface ProviderOwner {
  readonly unchanged: () => boolean;
  readonly bucket?: (name: string) => object | undefined;
  readonly forwarded?: S3Client;
}
const providers = new WeakMap<S3Client, ProviderOwner>();
const operations = ["headObject", "getObject", "putObject", "deleteObject", "copyObject", "listObjectsV2", "getObjectStream", "putObjectStream"] as const;

function unchangedClient(client: S3Client): () => boolean {
  const methods = operations.map(name => client[name]);
  return () => operations.every((name, index) => client[name] === methods[index]);
}

export function registerMockS3Owner(client: S3Client, bucket: (name: string) => object | undefined, intact: () => boolean): void {
  const unchanged = unchangedClient(client);
  providers.set(client, { unchanged: () => unchanged() && intact(), bucket });
}

export function forwardS3Owner(client: S3Client, transport: S3Client): void {
  providers.set(transport, { unchanged: unchangedClient(transport), forwarded: client });
}

function ownedS3Bucket(client: S3Client, name: string): object | undefined {
  const visited = new Set<S3Client>();
  let current: S3Client | undefined = client;
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const owner: ProviderOwner | undefined = providers.get(current);
    if (!owner?.unchanged()) return undefined;
    if (owner.bucket) return owner.bucket(name);
    current = owner.forwarded;
  }
  return undefined;
}

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

export function registerS3EntryOwner(filesystem: FileSystem, normalize: (path: string) => string, client: S3Client, bucket: string): void {
  const names = ["stat", "lstat", "realpath", "readFile", "writeFile", "copyFile", "rename", "readStream", "writeStream"] as const;
  const methods = names.map(name => filesystem[name]);
  entries.set(filesystem, view => {
    if (!names.every((name, index) => filesystem[name] === methods[index])) return undefined;
    const storage = ownedS3Bucket(client, bucket);
    if (!storage) return undefined;
    const observation = observedStats.get(view.stat);
    return observation?.filesystem === filesystem && observation.path === normalize(view.path)
      && observation.entry.storage === storage ? observation.entry : undefined;
  });
}

export function getOwnedS3Entry(view: EntryView): OwnedS3Entry | undefined {
  return entries.get(view.filesystem)?.(view);
}

export async function compareOwnedS3Entries(own: EntryView, peer: EntryView, options: FsOptions): Promise<EntryComparison> {
  options.signal?.throwIfAborted();
  const left = getOwnedS3Entry(own);
  options.signal?.throwIfAborted();
  const right = getOwnedS3Entry(peer);
  options.signal?.throwIfAborted();
  if (!left || !right) return "unknown";
  return left.storage === right.storage && left.key === right.key ? "same" : "distinct";
}

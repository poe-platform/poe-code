import { AsyncLocalStorage } from "node:async_hooks";
import type { FileStat, FileSystem, FsOptions } from "../../contracts/filesystem.js";
import type { S3HeadOutput, S3ObjectInput } from "./transport.js";

import { recordS3Observation } from "./registry.js";
import type { OwnedS3Entry } from "./registry.js";
export { registerS3EntryOwner, getOwnedS3Entry, compareOwnedS3Entries } from "./registry.js";
export type { OwnedS3Entry } from "./registry.js";

interface HeadProof {
  readonly query: S3ObjectInput;
  readonly entry: OwnedS3Entry;
}

const queries = new AsyncLocalStorage<S3ObjectInput>();
const providerHeads = new WeakMap<S3HeadOutput, HeadProof>();
const acceptedHeads = new WeakMap<S3HeadOutput, OwnedS3Entry>();
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
  if (entry) recordS3Observation(filesystem, path, stat, entry);
}

export interface ScopedTransportBudgetFrame {
  credit: number;
  readonly admit: (options?: FsOptions) => void;
}

const transportBudgets = new AsyncLocalStorage<readonly ScopedTransportBudgetFrame[]>();

export function getScopedTransportBudget(): readonly ScopedTransportBudgetFrame[] | undefined {
  return transportBudgets.getStore();
}

export function withScopedTransportBudget<Result>(
  frames: readonly ScopedTransportBudgetFrame[] | undefined,
  action: () => Result,
): Result {
  return frames ? transportBudgets.run(frames, action) : action();
}

export function runScopedTransportBudget<Result>(
  admit: (options?: FsOptions) => void,
  action: () => Result,
  credit = 1,
): Result {
  const parent = transportBudgets.getStore() ?? [];
  const frame: ScopedTransportBudgetFrame = { credit, admit };
  return transportBudgets.run([...parent, frame], action);
}

export function chargeScopedTransportCall(options?: FsOptions): void {
  const frames = transportBudgets.getStore();
  if (!frames) return;
  for (const frame of frames) {
    if (frame.credit > 0) frame.credit--;
    else frame.admit(options);
  }
}

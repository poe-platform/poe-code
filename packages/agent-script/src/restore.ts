import { hashSource } from "./parse/hash.js";
import { replaceErrorStack } from "./error/shape.js";
import { validateDumpEnvelope } from "./snapshot/validation.js";
import { assertSnapshotInactive } from "./interp/running-state.js";

export type AgentScriptSnapshot = {
  version?: number;
  sourceHash: string;
  clock?: {
    next: number;
  };
  random?: {
    seed: number;
    state: number;
  };
  [key: string]: unknown;
};

export type RestoreOptions = {
  source: string;
};

export class SnapshotMismatchError extends Error {
  readonly actualHash: string;
  readonly expectedHash: string;

  constructor(expectedHash: string, actualHash: string) {
    super(
      `source changed since snapshot was taken (hash ${expectedHash} expected, got ${actualHash}); pass --reset to discard`
    );
    this.name = "SnapshotMismatchError";
    this.actualHash = actualHash;
    this.expectedHash = expectedHash;
    replaceErrorStack(this);
  }
}

export function restore<TSnapshot extends AgentScriptSnapshot>(
  snapshot: TSnapshot,
  options: RestoreOptions
): TSnapshot {
  assertSnapshotInactive(snapshot);
  validateDumpEnvelope(snapshot);

  const currentSourceHash = hashSource(options.source);

  if (snapshot.sourceHash !== currentSourceHash) {
    throw new SnapshotMismatchError(snapshot.sourceHash, currentSourceHash);
  }

  return snapshot;
}

import { hashSource } from "./parse/hash.js";
import { replaceErrorStack } from "./error/shape.js";
import { SnapshotValidationError, validateDumpEnvelope } from "./snapshot/validation.js";
import { EXECUTION_SEMANTICS } from "./snapshot/dump-format.js";
import { assertSnapshotInactive } from "./interp/running-state.js";
import { validateSnapshotMigration, type SnapshotMigration } from "./snapshot/migration.js";

export type SafeJSSnapshot = {
  version?: number;
  sourceHash: string;
  migration?: SnapshotMigration;
  clock?: {
    next: number;
  };
  random?: {
    seed: number;
    state: number;
    initialState?: number;
    resumeState?: number;
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

export function restore<TSnapshot extends SafeJSSnapshot>(
  snapshot: TSnapshot,
  options: RestoreOptions
): TSnapshot {
  assertSnapshotInactive(snapshot);
  validateDumpEnvelope(snapshot);
  validateSnapshotMigration(snapshot.migration, snapshot.sourceHash);

  if (
    snapshot.executionSemantics !== EXECUTION_SEMANTICS &&
    snapshot.executionSemantics !== "jobs-v6" &&
    (snapshot.executionSemantics !== undefined ||
      snapshot.promiseReplay !== undefined ||
      snapshot.replay !== undefined ||
      snapshot.initialInputs !== undefined)
  ) {
    throw new SnapshotValidationError(
      "unsupportedVersion",
      "$.executionSemantics",
      "incompatible execution semantics; resume with the SafeJS version that created this snapshot. Migration requires explicit reconciliation, not changing its version marker."
    );
  }

  const currentSourceHash = hashSource(options.source);

  if (snapshot.sourceHash !== currentSourceHash) {
    throw new SnapshotMismatchError(snapshot.sourceHash, currentSourceHash);
  }

  return snapshot;
}

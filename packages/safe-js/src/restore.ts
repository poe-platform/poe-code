import { validateGuestHeapSource } from "./snapshot/guest-heap-source.js";
import { hashParsedAst, hashSource } from "./parse/hash.js";
import { SandboxError, type CompileOwner } from "./interp/budget.js";
import { replaceErrorStack } from "./error/shape.js";
import { SnapshotValidationError, validateDumpEnvelope, validateRuntimeSnapshotDescriptors } from "./snapshot/validation.js";
import { inMemoryRunSnapshots, serializeSafeJSSnapshot } from "./snapshot/dump-format.js";
import { assertSnapshotInactive } from "./interp/running-state.js";
import { validateSnapshotMigration, type SnapshotMigration } from "./snapshot/migration.js";
import { parseExecutableModule, parseModule } from "./parse/parser.js";

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
  importSpecifiers?: readonly string[];
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
  options: RestoreOptions,
  owner?: CompileOwner
): TSnapshot {
  assertSnapshotInactive(snapshot);
  try {
    validateDumpEnvelope(snapshot, { resume: true });
  } catch (error) {
    if (!(error instanceof SnapshotValidationError) || error.code !== "invalidState" || error.path === "$.replayError" ||
        !inMemoryRunSnapshots.has(snapshot)) throw error;
    // Runtime snapshots can retain guest descriptor state. Use the same portable
    // representation as dump(), then apply all normal validation below.
    validateRuntimeSnapshotDescriptors(snapshot);
    snapshot = JSON.parse(serializeSafeJSSnapshot(snapshot)) as TSnapshot;
    validateDumpEnvelope(snapshot, { resume: true });
  }
  validateSnapshotMigration(snapshot.migration, snapshot.sourceHash, owner);

  const includeFunctionSource = snapshot.executionSemantics !== "jobs-v6" && snapshot.executionSemantics !== "jobs-v7";
  const currentSourceHash = options.importSpecifiers === undefined
    ? hashSource(options.source, owner, includeFunctionSource)
    : hashParsedAst(parseExecutableModule(options.source, "<input>", owner, options.importSpecifiers), includeFunctionSource);

  if (snapshot.sourceHash !== currentSourceHash) {
    throw new SnapshotMismatchError(snapshot.sourceHash, currentSourceHash);
  }

  if (snapshot.heap !== undefined && typeof snapshot.heap === "object" && snapshot.heap !== null) {
    try { validateGuestHeapSource(snapshot.heap as Record<string, unknown>, options.importSpecifiers === undefined
      ? parseModule(options.source, "<input>", owner)
      : parseExecutableModule(options.source, "<input>", owner, options.importSpecifiers), owner); }
    catch (error) {
      if (error instanceof SnapshotValidationError || error instanceof SandboxError) throw error;
      throw new SnapshotValidationError("invalidValue", "$.heap", String(error));
    }
  }

  return snapshot;
}

import { hashSource } from "./parse/hash.js";
import type { CompileOwner } from "./interp/budget.js";
import { replaceErrorStack } from "./error/shape.js";
import { SnapshotValidationError, validateDumpEnvelope } from "./snapshot/validation.js";
import { EXECUTION_SEMANTICS, inMemoryRunSnapshots, serializeSafeJSSnapshot } from "./snapshot/dump-format.js";
import { assertSnapshotInactive } from "./interp/running-state.js";
import { validateSnapshotMigration, type SnapshotMigration } from "./snapshot/migration.js";
import { parseModule } from "./parse/parser.js";
import { validateGuestFunctionAst } from "./snapshot/guest-ast-validation.js";
import { validateTemplateObjects } from "./snapshot/template-validation.js";
import type { ParseResult } from "./parse.js";

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
  options: RestoreOptions,
  owner?: CompileOwner
): TSnapshot {
  assertSnapshotInactive(snapshot);
  try {
    validateDumpEnvelope(snapshot);
  } catch (error) {
    if (!(error instanceof SnapshotValidationError) || error.code !== "invalidState" ||
        !inMemoryRunSnapshots.has(snapshot)) throw error;
    // Runtime snapshots can retain guest descriptor state. Use the same portable
    // representation as dump(), then apply all normal validation below.
    snapshot = JSON.parse(serializeSafeJSSnapshot(snapshot)) as TSnapshot;
    validateDumpEnvelope(snapshot);
  }
  validateSnapshotMigration(snapshot.migration, snapshot.sourceHash, owner);

  if (
    snapshot.executionSemantics !== EXECUTION_SEMANTICS &&
    snapshot.executionSemantics !== "jobs-v6" &&
    snapshot.executionSemantics !== "jobs-v7" &&
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

  const currentSourceHash = hashSource(
    options.source,
    owner,
    snapshot.executionSemantics !== "jobs-v6" && snapshot.executionSemantics !== "jobs-v7"
  );

  if (snapshot.sourceHash !== currentSourceHash) {
    throw new SnapshotMismatchError(snapshot.sourceHash, currentSourceHash);
  }

  if (snapshot.heap !== undefined && typeof snapshot.heap === "object" && snapshot.heap !== null) {
    const closures = Object.entries(snapshot.heap).filter(([, value]) =>
      value !== null && typeof value === "object" && (["guest-function", "guest-class", "guest-generator"].includes(String((value as Record<string, unknown>).kind)) ||
        (value as Record<string, unknown>).templateNodeId !== undefined));
    if (closures.length > 0) {
      const functions = new Map<number, Record<string, unknown>>();
      const pending: unknown[] = [parseModule(options.source, "<input>", owner)];
      while (pending.length > 0) {
        const value = pending.pop();
        if (value === null || typeof value !== "object") continue;
        const node = value as Record<string, unknown>;
        if (typeof node.nodeId === "number") {
          functions.set(node.nodeId, node);
        }
        for (const entry of Object.values(node)) pending.push(entry);
      }
      for (const [id, value] of closures) {
        const record = value as Record<string, unknown>;
        if (record.kind === "guest-array") continue;
        const origin = functions.get(record.astNodeId as number);
        try { validateGuestFunctionAst(record, origin); }
        catch (error) {
          throw new SnapshotValidationError("invalidValue", `$.heap[${JSON.stringify(id)}].astNodeId`, error instanceof Error ? error.message : String(error));
        }
      }
      try { validateTemplateObjects(snapshot.heap as Record<string, unknown>, functions.values() as Iterable<ParseResult>); }
      catch (error) { throw new SnapshotValidationError("invalidValue", "$.heap", String(error)); }
    }
  }

  return snapshot;
}

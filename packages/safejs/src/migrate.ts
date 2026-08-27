import { createHash } from "node:crypto";

import { assertSnapshotInactive } from "./interp/running-state.js";
import { deepCopyToSandbox } from "./interp/values.js";
import { hashSource } from "./parse/hash.js";
import { parseModule } from "./parse/parser.js";
import type { SafeJSSnapshot } from "./restore.js";
import { DUMP_FORMAT_VERSION, EXECUTION_SEMANTICS } from "./snapshot/dump-format.js";
import {
  validateMigrationJournal,
  validateMigrationReconciliation,
  validateMigrationSemantics,
  validateSnapshotMigration,
  type SnapshotMigration,
  type SnapshotMigrationReconciliation
} from "./snapshot/migration.js";
import { encodeReplayData } from "./snapshot/replay-data.js";
import { validateDumpEnvelope, validateSnapshotData } from "./snapshot/validation.js";

export type {
  SnapshotMigration,
  SnapshotMigrationReconciliation,
  SnapshotMigrationResolution
} from "./snapshot/migration.js";

export type SnapshotMigrationOptions = {
  source: string;
  targetSource: string;
  state: unknown;
  reconciliation: SnapshotMigrationReconciliation;
};

export function inspectSnapshotMigration(snapshot: SafeJSSnapshot, options: { source: string }) {
  assertSnapshotInactive(snapshot);
  validateSnapshotData(snapshot);
  validateDumpEnvelope(snapshot);
  validateMigrationSemantics(snapshot.executionSemantics);
  const sourceHash = hashSource(options.source);
  if (snapshot.sourceHash !== sourceHash)
    throw new TypeError(
      `Migration requires the original executable source (checkpoint hash ${snapshot.sourceHash}, supplied ${sourceHash}). Preserve the checkpoint; do not replace its hash.`
    );
  validateSnapshotMigration(snapshot.migration, sourceHash);
  const replay = validateMigrationJournal(sourceHash, snapshot.replay, snapshot.hostCalls);
  return {
    checkpointDigest: createHash("sha256").update(canonicalData(snapshot)).digest("hex"),
    sourceHash,
    executionSemantics: snapshot.executionSemantics,
    calls: replay.calls,
    unresolvedCalls: replay.calls.filter(
      (call) => !["settled", "consumed"].includes(call.lifecycle)
    )
  };
}

export function migrateSnapshot(
  snapshot: SafeJSSnapshot,
  options: SnapshotMigrationOptions
): SafeJSSnapshot & { migration: SnapshotMigration } {
  if (!Object.hasOwn(options, "state"))
    throw new TypeError("Migration requires explicit application state.");
  const inspection = inspectSnapshotMigration(snapshot, { source: options.source });
  parseModule(options.targetSource);
  const targetSourceHash = hashSource(options.targetSource);
  validateMigrationReconciliation(
    options.reconciliation,
    inspection.checkpointDigest,
    inspection.calls
  );
  const state = encodeReplayData(deepCopyToSandbox(options.state));
  const previous = snapshot.migration as SnapshotMigration | undefined;
  const migration: SnapshotMigration = {
    version: 1,
    state,
    history: [
      ...structuredClone(previous?.history ?? []),
      {
        sourceHash: inspection.sourceHash,
        targetSourceHash,
        executionSemantics: inspection.executionSemantics,
        replay: { version: 1, calls: inspection.calls },
        reconciliation: structuredClone(options.reconciliation)
      }
    ]
  };
  validateSnapshotMigration(migration, targetSourceHash);
  return {
    version: DUMP_FORMAT_VERSION,
    executionSemantics: EXECUTION_SEMANTICS,
    sourceHash: targetSourceHash,
    bindings: {},
    replay: { version: 1, calls: [] },
    migration
  };
}

function canonicalData(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalData).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalData((value as Record<string, unknown>)[key])}`
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

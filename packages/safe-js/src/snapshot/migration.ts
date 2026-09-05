import { HostCallJournal, type HostCallRecord, type HostCallReplay } from "../interp/host-call.js";
import { decodeReplayData, type ReplayData } from "./replay-data.js";
import { validateSnapshotData } from "./validation.js";
import type { CompileOwner } from "../interp/budget.js";
import { CompileScope } from "../interp/regex/compile-guard.js";

export type SnapshotMigrationResolution =
  | { callId: string; disposition: "not-performed" }
  | { callId: string; disposition: "fulfilled"; value: unknown }
  | { callId: string; disposition: "rejected"; reason: unknown };

export type SnapshotMigrationReconciliation = {
  checkpointDigest: string;
  quiescent: boolean;
  calls: SnapshotMigrationResolution[];
};

export type SnapshotMigration = {
  version: 1;
  state: ReplayData;
  history: Array<{
    sourceHash: string;
    targetSourceHash: string;
    executionSemantics: string;
    replay: HostCallReplay;
    reconciliation: SnapshotMigrationReconciliation;
  }>;
};

export function validateMigrationSemantics(value: unknown): asserts value is string {
  if (
    !["jobs-v1", "jobs-v2", "jobs-v3", "jobs-v4", "jobs-v5", "jobs-v6", "jobs-v7", "jobs-v8"].includes(
      value as string
    )
  )
    throw new TypeError(
      "Migration requires a supported execution-semantics marker (jobs-v1 through jobs-v8)."
    );
}

export function validateMigrationJournal(
  sourceHash: string,
  replay: unknown,
  hostCalls: unknown = [],
  owner?: CompileOwner
): HostCallReplay {
  if (replay === undefined)
    throw new TypeError("Migration requires a complete host replay journal.");
  if (!Array.isArray(hostCalls)) throw new TypeError("Invalid migration hostCalls.");
  const journal = new HostCallJournal(
    sourceHash,
    hostCalls as HostCallRecord[],
    undefined,
    replay,
    owner?.budget,
    owner
  );
  try {
    const restored = journal.snapshotReplay();
    for (const call of restored.calls) {
      if (["created", "running"].includes(call.lifecycle) && call.outcome !== undefined)
        throw new TypeError("Unresolved migration calls cannot contain a recorded outcome.");
      for (const callback of call.callbacks ?? []) {
        if (!call.functions?.includes(callback.id))
          throw new TypeError("Migration callback has no registered source function.");
      }
    }
    return restored;
  } finally {
    journal.dispose();
  }
}

export function validateMigrationReconciliation(
  value: unknown,
  checkpointDigest: string,
  calls: HostCallReplay["calls"]
): asserts value is SnapshotMigrationReconciliation {
  validateSnapshotData(value);
  const receipt = value as SnapshotMigrationReconciliation;
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    receipt.checkpointDigest !== checkpointDigest ||
    !isCheckpointDigest(receipt.checkpointDigest)
  )
    throw new TypeError("Migration reconciliation must identify this exact checkpoint digest.");
  if (receipt.quiescent !== true)
    throw new TypeError(
      "Migration requires explicit host confirmation that execution, operations, and callbacks are quiescent."
    );
  if (!Array.isArray(receipt.calls))
    throw new TypeError("Migration reconciliation calls must be an array.");
  const pending = new Map(
    calls
      .filter((call) => !["settled", "consumed"].includes(call.lifecycle))
      .map((call) => [call.id, call])
  );
  for (const resolution of receipt.calls) {
    if (resolution === null || typeof resolution !== "object" || !pending.has(resolution.callId))
      throw new TypeError("Migration contains an unknown or duplicate call resolution.");
    if (
      !["not-performed", "fulfilled", "rejected"].includes(resolution.disposition) ||
      (resolution.disposition === "fulfilled" && !Object.hasOwn(resolution, "value")) ||
      (resolution.disposition === "rejected" && !Object.hasOwn(resolution, "reason"))
    )
      throw new TypeError(
        "Migration call resolution requires a reconciled outcome or confirmed non-performance."
      );
    pending.delete(resolution.callId);
  }
  if (pending.size > 0)
    throw new TypeError(
      `Migration requires external reconciliation for: ${[...pending.keys()].join(", ")}`
    );
}

export function validateSnapshotMigration(
  value: unknown,
  sourceHash: string,
  owner?: CompileOwner
): SnapshotMigration | undefined {
  if (value === undefined) return undefined;
  validateSnapshotData(value);
  const migration = value as SnapshotMigration;
  if (
    migration === null ||
    typeof migration !== "object" ||
    migration.version !== 1 ||
    !Array.isArray(migration.history) ||
    migration.history.length === 0
  )
    throw new TypeError("Invalid snapshot migration history.");
  const compilation = new CompileScope(owner);
  try {
    decodeReplayData(migration.state, {}, compilation);
  } finally {
    compilation.dispose();
  }
  let previousTarget: string | undefined;
  for (const entry of migration.history) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.sourceHash !== "string" ||
      entry.sourceHash.length === 0 ||
      typeof entry.targetSourceHash !== "string" ||
      entry.targetSourceHash.length === 0 ||
      (previousTarget !== undefined && previousTarget !== entry.sourceHash)
    )
      throw new TypeError("Invalid snapshot migration ancestry.");
    validateMigrationSemantics(entry.executionSemantics);
    const replay = validateMigrationJournal(entry.sourceHash, entry.replay, [], owner);
    validateMigrationReconciliation(
      entry.reconciliation,
      entry.reconciliation?.checkpointDigest,
      replay.calls
    );
    previousTarget = entry.targetSourceHash;
  }
  if (previousTarget !== sourceHash)
    throw new TypeError("Migration ancestry does not match the target source.");
  return migration;
}

function isCheckpointDigest(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 64 &&
    [...value].every((character) => "0123456789abcdef".includes(character))
  );
}

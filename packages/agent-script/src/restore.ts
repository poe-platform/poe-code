import { hashSource } from "./parse/hash.js";
import { replaceErrorStack } from "./error/shape.js";
import { DUMP_FORMAT_VERSION } from "./snapshot/dump-format.js";

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
  assertCompatibleDumpVersion(snapshot);
  assertSourceHash(snapshot);

  const currentSourceHash = hashSource(options.source);

  if (snapshot.sourceHash !== currentSourceHash) {
    throw new SnapshotMismatchError(snapshot.sourceHash, currentSourceHash);
  }

  return snapshot;
}

function assertCompatibleDumpVersion(snapshot: AgentScriptSnapshot): void {
  if (snapshot.version !== DUMP_FORMAT_VERSION) {
    throw new Error(
      `incompatible dump version: expected ${DUMP_FORMAT_VERSION}, got ${describeDumpVersion(snapshot)}`
    );
  }
}

function assertSourceHash(snapshot: AgentScriptSnapshot): void {
  if (typeof snapshot.sourceHash !== "string" || snapshot.sourceHash.length === 0) {
    throw new Error("invalid dump file: sourceHash must be a non-empty string");
  }
}

function describeDumpVersion(snapshot: AgentScriptSnapshot): string {
  if (!Object.hasOwn(snapshot, "version")) {
    return "missing";
  }

  return typeof snapshot.version === "number" ? String(snapshot.version) : String(snapshot.version);
}

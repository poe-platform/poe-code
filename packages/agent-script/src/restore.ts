import { hashSource } from "./parse/hash.js";

export type AgentScriptSnapshot = {
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

export function restore<TSnapshot extends AgentScriptSnapshot>(
  snapshot: TSnapshot,
  options: RestoreOptions
): TSnapshot {
  const currentSourceHash = hashSource(options.source);

  if (snapshot.sourceHash !== currentSourceHash) {
    throw new Error(
      `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, got ${currentSourceHash}); pass --reset to discard`
    );
  }

  return snapshot;
}

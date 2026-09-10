import { hashSource } from "./parse/hash.js";
import type { CompileOwner } from "./interp/budget.js";
import { replaceErrorStack } from "./error/shape.js";
import { SnapshotValidationError, validateDumpEnvelope } from "./snapshot/validation.js";
import { inMemoryRunSnapshots, serializeSafeJSSnapshot } from "./snapshot/dump-format.js";
import { assertSnapshotInactive } from "./interp/running-state.js";
import { validateSnapshotMigration, type SnapshotMigration } from "./snapshot/migration.js";
import { parseModule } from "./parse/parser.js";
import { createModuleSource, createDynamicSource, createEvalSource, type DynamicSource, type EvalSourceContext } from "./parse/dynamic-source.js";
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
    validateDumpEnvelope(snapshot, { resume: true });
  } catch (error) {
    if (!(error instanceof SnapshotValidationError) || error.code !== "invalidState" ||
        !inMemoryRunSnapshots.has(snapshot)) throw error;
    // Runtime snapshots can retain guest descriptor state. Use the same portable
    // representation as dump(), then apply all normal validation below.
    snapshot = JSON.parse(serializeSafeJSSnapshot(snapshot)) as TSnapshot;
    validateDumpEnvelope(snapshot, { resume: true });
  }
  validateSnapshotMigration(snapshot.migration, snapshot.sourceHash, owner);

  const currentSourceHash = hashSource(
    options.source,
    owner,
    snapshot.executionSemantics !== "jobs-v6" && snapshot.executionSemantics !== "jobs-v7"
  );

  if (snapshot.sourceHash !== currentSourceHash) {
    throw new SnapshotMismatchError(snapshot.sourceHash, currentSourceHash);
  }

  if (snapshot.heap !== undefined && typeof snapshot.heap === "object" && snapshot.heap !== null) {
    const entries = Object.entries(snapshot.heap);
    const closures = entries.filter(([, value]) =>
      value !== null && typeof value === "object" && (["guest-function", "guest-class", "guest-generator"].includes(String((value as Record<string, unknown>).kind)) ||
        (value as Record<string, unknown>).templateNodeId !== undefined));
    const dynamicSources = new Map<number, DynamicSource>();
    for (const [id, value] of entries) {
      const record = value as Record<string, unknown>;
      if (record.kind === "guest-source" || record.kind === "guest-script") {
        try {
          const compiled = record.kind === "guest-script"
            ? createEvalSource(record.body as string, record.context as EvalSourceContext, owner)
            : record.functionKind === "module" ? createModuleSource(record.body as string, owner)
            : createDynamicSource(record.functionKind as Exclude<DynamicSource["kind"], "eval" | "module">,
              record.parameters as string, record.body as string, owner);
          dynamicSources.set(Number(id), compiled.source);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          throw new SnapshotValidationError("invalidValue", `$.heap[${JSON.stringify(id)}]`, error.message);
        }
      }
    }
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
        const nodes = record.dynamicSource === undefined ? functions
          : dynamicSources.get((record.dynamicSource as {id: number}).id)!.nodes;
        const origin = nodes.get(record.astNodeId as number);
        try { validateGuestFunctionAst(record, origin); }
        catch (error) {
          throw new SnapshotValidationError("invalidValue", `$.heap[${JSON.stringify(id)}].astNodeId`, error instanceof Error ? error.message : String(error));
        }
      }
      try { validateTemplateObjects(snapshot.heap as Record<string, unknown>, functions.values() as Iterable<ParseResult>, dynamicSources); }
      catch (error) { throw new SnapshotValidationError("invalidValue", "$.heap", String(error)); }
    }
  }

  return snapshot;
}

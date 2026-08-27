import { describe, expect, it, vi } from "vitest";

import { dump } from "./dump.js";
import { Budget } from "./interp/budget.js";
import { inspectSnapshotMigration, migrateSnapshot } from "./migrate.js";
import { restore, type SafeJSSnapshot } from "./restore.js";
import { run } from "./run.js";

async function completedCheckpoint(source = "return 1;"): Promise<SafeJSSnapshot> {
  const execution = run(source);
  await execution;
  return JSON.parse(await dump(execution));
}

describe("explicit checkpoint migration", () => {
  it("rejects archived callbacks without a registered source function", async () => {
    const source = "return await invoke(value => value + 1);";
    const execution = run(source, {
      bindings: { invoke: async (callback: (value: number) => unknown) => await callback(1) }
    });
    await execution;
    const snapshot = JSON.parse(await dump(execution));
    expect(snapshot.replay.calls[0].callbacks).toHaveLength(1);
    snapshot.replay.calls[0].callbacks[0].id = 999;
    expect(() => inspectSnapshotMigration(snapshot, { source })).toThrow("callback");
  });

  it("rejects recorded outcomes on unresolved calls", async () => {
    const source = "effect(); return 1;";
    const execution = run(source, { bindings: { effect: () => true } });
    await execution;
    const snapshot = JSON.parse(await dump(execution));
    snapshot.replay.calls[0].lifecycle = "running";
    expect(() => inspectSnapshotMigration(snapshot, { source })).toThrow("outcome");
  });

  it("charges migrated state to the target data budget before native effects", async () => {
    const source = "return 1;";
    const snapshot = await completedCheckpoint(source);
    const targetSource = "effect(); return import.meta.migration;";
    const migrated = migrateSnapshot(snapshot, {
      source,
      targetSource,
      state: "data".repeat(1000),
      reconciliation: {
        checkpointDigest: inspectSnapshotMigration(snapshot, { source }).checkpointDigest,
        quiescent: true,
        calls: []
      }
    });
    const effect = vi.fn();
    await expect(
      run(targetSource, {
        snapshot: migrated,
        bindings: { effect },
        budget: new Budget({ dataSize: 100 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(effect).not.toHaveBeenCalled();
  });

  it.each(["fulfilled", "rejected", "not-performed"] as const)(
    "requires a resolution for a pending operation: %s",
    async (disposition) => {
      let finish!: (value: number) => void;
      const effect = vi.fn(
        () =>
          new Promise<number>((resolve) => {
            finish = resolve;
          })
      );
      const source = "return await effect();";
      const execution = run(source, { bindings: { effect } });
      const snapshot = JSON.parse(await dump(execution));
      finish(4);
      await execution;
      const inspection = inspectSnapshotMigration(snapshot, { source });
      expect(inspection.unresolvedCalls).toHaveLength(1);
      const reconciliation = {
        checkpointDigest: inspection.checkpointDigest,
        quiescent: true,
        calls: []
      };
      const options = {
        source,
        targetSource: "return import.meta.migration;",
        state: 4,
        reconciliation
      };
      expect(() => migrateSnapshot(snapshot, options)).toThrow("external reconciliation");
      const resolution = {
        callId: inspection.unresolvedCalls[0]!.id,
        disposition,
        value: 4,
        reason: "denied"
      };
      expect(() =>
        migrateSnapshot(snapshot, {
          ...options,
          reconciliation: { ...reconciliation, calls: [resolution, resolution] }
        })
      ).toThrow("duplicate");
      const migrated = migrateSnapshot(snapshot, {
        ...options,
        reconciliation: { ...reconciliation, calls: [resolution] }
      });
      expect((await run(options.targetSource, { snapshot: migrated })).returnValue).toBe(4);
      expect(effect).toHaveBeenCalledOnce();
    }
  );

  it.each(["source", "ordinal", "outcome", "ancestry", "state-capability"])(
    "rejects corrupted archived history on restore: %s",
    async (mode) => {
      const source = "effect(); return 1;";
      const execution = run(source, { bindings: { effect: () => true } });
      await execution;
      const snapshot = JSON.parse(await dump(execution));
      const targetSource = "return import.meta.migration;";
      const migrated = migrateSnapshot(snapshot, {
        source,
        targetSource,
        state: 2,
        reconciliation: {
          checkpointDigest: inspectSnapshotMigration(snapshot, { source }).checkpointDigest,
          quiescent: true,
          calls: []
        }
      });
      const entry = migrated.migration.history[0]!;
      if (mode === "source") entry.replay.calls[0]!.sourceHash = "wrong";
      if (mode === "ordinal") entry.replay.calls[0]!.id = `${entry.replay.calls[0]!.runId}:3`;
      if (mode === "outcome") delete entry.replay.calls[0]!.outcome;
      if (mode === "ancestry") entry.targetSourceHash = "wrong";
      if (mode === "state-capability")
        migrated.migration.state = { root: { tag: "capability", id: "unsafe" }, nodes: [] };
      expect(() => restore(migrated, { source: targetSource })).toThrow();
    }
  );

  it.each([
    "return import.meta.migration.total + 1;",
    "export default function() { return import.meta.migration.total + 1; }",
    "export default async function() { return import.meta.migration.total + 1; }"
  ])("starts a new continuation without replaying old effects: %s", async (targetSource) => {
    const source = "effect(); return 8;";
    const effect = vi.fn(() => 8);
    const execution = run(source, { bindings: { effect } });
    await execution;
    const snapshot = JSON.parse(await dump(execution));
    const original = JSON.stringify(snapshot);
    const inspection = inspectSnapshotMigration(snapshot, { source });
    const migrated = migrateSnapshot(snapshot, {
      source,
      targetSource,
      state: { total: 8 },
      reconciliation: { checkpointDigest: inspection.checkpointDigest, quiescent: true, calls: [] }
    });
    expect(JSON.stringify(snapshot)).toBe(original);
    expect(effect).toHaveBeenCalledOnce();
    expect(migrated.sourceHash).not.toBe(snapshot.sourceHash);
    expect(migrated.replay).toEqual({ version: 1, calls: [] });
    expect(migrated).not.toHaveProperty("pendingAwaits");
    expect(migrated).not.toHaveProperty("promiseReplay");
    const entryPointArgs = targetSource.startsWith("export") ? [] : undefined;
    const continuation = run(targetSource, { snapshot: migrated, entryPointArgs });
    expect((await continuation).returnValue).toBe(9);
    const saved = JSON.parse(await dump(continuation));
    expect(saved.migration).toEqual(migrated.migration);
    expect((await run(targetSource, { snapshot: saved, entryPointArgs })).returnValue).toBe(9);
    expect(effect).toHaveBeenCalledOnce();
  });

  it.each(["jobs-v1", "jobs-v2", "jobs-v3", "jobs-v4"])(
    "migrates %s without weakening ordinary restore",
    async (executionSemantics) => {
      const source = "return 1;";
      const snapshot = { ...(await completedCheckpoint(source)), executionSemantics };
      expect(() => restore(snapshot, { source })).toThrow("incompatible execution semantics");
      const inspection = inspectSnapshotMigration(snapshot, { source });
      const targetSource = "return import.meta.migration;";
      const migrated = migrateSnapshot(snapshot, {
        source,
        targetSource,
        state: 2,
        reconciliation: {
          checkpointDigest: inspection.checkpointDigest,
          quiescent: true,
          calls: []
        }
      });
      expect((await run(targetSource, { snapshot: migrated })).returnValue).toBe(2);
    }
  );

  it("binds receipts to values but not object key order", async () => {
    const snapshot = await completedCheckpoint();
    const reordered = Object.fromEntries(Object.entries(snapshot).reverse()) as SafeJSSnapshot;
    expect(inspectSnapshotMigration(reordered, { source: "return 1;" }).checkpointDigest).toBe(
      inspectSnapshotMigration(snapshot, { source: "return 1;" }).checkpointDigest
    );
    const changed = { ...snapshot, bindings: { changed: true } };
    expect(inspectSnapshotMigration(changed, { source: "return 1;" }).checkpointDigest).not.toBe(
      inspectSnapshotMigration(snapshot, { source: "return 1;" }).checkpointDigest
    );
  });

  it.each(["wrong-source", "missing-journal", "future-semantics", "future-format", "accessor"])(
    "rejects unsafe migration input: %s",
    async (mode) => {
      const snapshot = await completedCheckpoint();
      let source = "return 1;";
      if (mode === "wrong-source") source = "return 2;";
      if (mode === "missing-journal") delete snapshot.replay;
      if (mode === "future-semantics") snapshot.executionSemantics = "jobs-v100";
      if (mode === "future-format") snapshot.version = 100;
      const getter = vi.fn(() => true);
      if (mode === "accessor")
        Object.defineProperty(snapshot, "unsafe", { enumerable: true, get: getter });
      expect(() => inspectSnapshotMigration(snapshot, { source })).toThrow(
        mode === "wrong-source" ? "original executable source" : undefined
      );
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it.each(["stale", "not-quiescent", "extra-call", "invalid-source", "function-state"])(
    "refuses invalid transitions: %s",
    async (mode) => {
      const source = "return 1;";
      const snapshot = await completedCheckpoint(source);
      const inspection = inspectSnapshotMigration(snapshot, { source });
      expect(() =>
        migrateSnapshot(snapshot, {
          source,
          targetSource: mode === "invalid-source" ? "return (" : "return import.meta.migration;",
          state: mode === "function-state" ? () => 3 : { total: 3 },
          reconciliation: {
            checkpointDigest: mode === "stale" ? "wrong" : inspection.checkpointDigest,
            quiescent: mode !== "not-quiescent",
            calls:
              mode === "extra-call" ? [{ callId: "unknown:1", disposition: "not-performed" }] : []
          }
        })
      ).toThrow();
    }
  );

  it("preserves cyclic application state without injecting capabilities", async () => {
    const source = "return 1;";
    const snapshot = await completedCheckpoint(source);
    const state: { name: string; self?: unknown; values: Map<string, number> } = {
      name: "mapped",
      values: new Map([["count", 4]])
    };
    state.self = state;
    const migrated = migrateSnapshot(snapshot, {
      source,
      targetSource:
        "return [import.meta.migration.self === import.meta.migration, import.meta.migration.values.get('count')];",
      state,
      reconciliation: {
        checkpointDigest: inspectSnapshotMigration(snapshot, { source }).checkpointDigest,
        quiescent: true,
        calls: []
      }
    });
    state.values.set("count", 99);
    expect(
      (
        await run(
          "return [import.meta.migration.self === import.meta.migration, import.meta.migration.values.get('count')];",
          {
            snapshot: JSON.parse(JSON.stringify(migrated))
          }
        )
      ).returnValue
    ).toEqual([true, 4]);
  });

  it("retains ancestry and current effects after budget failure and another migration", async () => {
    const source = "return 1;";
    const snapshot = await completedCheckpoint(source);
    const targetSource = "effect(); while(true) {}";
    const migrated = migrateSnapshot(snapshot, {
      source,
      targetSource,
      state: { completed: 1 },
      reconciliation: {
        checkpointDigest: inspectSnapshotMigration(snapshot, { source }).checkpointDigest,
        quiescent: true,
        calls: []
      }
    });
    const effect = vi.fn(() => true);
    const execution = run(targetSource, {
      snapshot: migrated,
      bindings: { effect },
      budget: new Budget({ maxSteps: 50 })
    });
    await expect(execution).rejects.toMatchObject({ code: "budgetExceeded" });
    const failed = JSON.parse(await dump(execution, { onFailure: "checkpoint" }));
    expect(failed.migration).toEqual(migrated.migration);
    const nextSource = "return import.meta.migration.completed;";
    const next = migrateSnapshot(failed, {
      source: targetSource,
      targetSource: nextSource,
      state: { completed: 2 },
      reconciliation: {
        checkpointDigest: inspectSnapshotMigration(failed, { source: targetSource })
          .checkpointDigest,
        quiescent: true,
        calls: []
      }
    });
    expect(next.migration.history).toHaveLength(2);
    expect((await run(nextSource, { snapshot: next })).returnValue).toBe(2);
    expect(effect).toHaveBeenCalledOnce();
  });
});

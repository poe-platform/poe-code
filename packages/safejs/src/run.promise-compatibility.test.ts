import { describe, expect, it, vi } from "vitest";

import {
  declareHostOperation,
  dump,
  inspectSnapshotMigration,
  migrateSnapshot,
  restore,
  run
} from "./index.js";
import legacyCaptures from "../test/fixtures/public-promise-v6.json" with { type: "json" };

const legacyCases = legacyCaptures.cases.flatMap((fixture) =>
  (["saved", "completed"] as const).map((kind) => ({ ...fixture, kind, snapshot: fixture[kind] }))
);

describe("genuine v6 checkpoint compatibility", () => {
  it.each(legacyCases)(
    "retains $name/$kind replay, effects, input bytes, and subsequent checkpoint semantics",
    async ({ kind, source, snapshot, completed }) => {
      const before = JSON.stringify(snapshot);
      const boundary = vi.fn(async (label: unknown) => ({ boundary: label }));
      const readValue = vi.fn(async () => ({ value: 99 }));
      const provider = vi.fn();
      const bindings = {
        boundary: declareHostOperation(boundary, "re-issue"),
        readValue: declareHostOperation(readValue, "re-issue")
      };
      expect(restore(snapshot, { source })).toBe(snapshot);
      const result = await run(source, {
        snapshot,
        bindings,
        hostCallResumeProvider: provider
      });
      expect(result).toMatchObject({ ok: true, returnValue: { value: 7 } });
      expect(JSON.stringify(snapshot)).toBe(before);
      expect(boundary.mock.calls).toEqual(kind === "saved" ? [["before"]] : []);
      expect(readValue).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
      expect(result.snapshot).toMatchObject({
        executionSemantics: "jobs-v6",
        initialInputs: completed.initialInputs,
        promiseReplay: completed.promiseReplay,
        replay: completed.replay
      });
      const saved = JSON.parse(await dump(result));
      const serialized = JSON.stringify(saved);
      for (let repeat = 0; repeat < 2; repeat++) {
        boundary.mockClear();
        const repeated = await run(source, {
          snapshot: restore(saved, { source }),
          bindings,
          hostCallResumeProvider: provider
        });
        expect(repeated).toMatchObject({
          ok: true,
          returnValue: { value: 7 },
          snapshot: { executionSemantics: "jobs-v6" }
        });
        expect(JSON.stringify(saved)).toBe(serialized);
        expect(boundary).not.toHaveBeenCalled();
        expect(readValue).not.toHaveBeenCalled();
        expect(provider).not.toHaveBeenCalled();
      }
    }
  );

  it("retains v6 on a failure checkpoint and replays the saved failure without effects", async () => {
    const fixture = legacyCases.find(({ name, kind }) => name === "data" && kind === "saved")!;
    const boundary = vi.fn(async () => {
      throw new Error("boundary failed");
    });
    const bindings = { boundary: declareHostOperation(boundary, "re-issue") };
    const execution = run(fixture.source, {
      snapshot: restore(fixture.snapshot, { source: fixture.source }),
      bindings
    });
    await expect(execution).rejects.toThrow("boundary failed");
    const snapshot = JSON.parse(await dump(execution, { onFailure: "checkpoint" }));
    expect(snapshot.executionSemantics).toBe("jobs-v6");
    boundary.mockClear();
    const resumed = run(fixture.source, {
      snapshot: restore(snapshot, { source: fixture.source }),
      bindings
    });
    await expect(resumed).rejects.toThrow("boundary failed");
    expect(JSON.parse(await dump(resumed, { onFailure: "checkpoint" })).executionSemantics).toBe(
      "jobs-v6"
    );
    expect(boundary).not.toHaveBeenCalled();
  });

  it("still rejects a v6 source mismatch before reading caller inputs", async () => {
    const readInputs = vi.fn(() => {
      throw new Error("caller inputs were read");
    });
    const options = Object.defineProperty({ snapshot: legacyCases[0].snapshot }, "bindings", {
      get: readInputs
    });
    await expect(run("return 7;", options)).rejects.toMatchObject({
      name: "SnapshotMismatchError"
    });
    expect(readInputs).not.toHaveBeenCalled();
  });

  it("retains genuine completed v6 history during an explicitly chosen migration", async () => {
    const fixture = legacyCases.find(({ name, kind }) => name === "host" && kind === "completed")!;
    const before = JSON.stringify(fixture.snapshot);
    const inspection = inspectSnapshotMigration(fixture.snapshot, { source: fixture.source });
    expect(inspection.executionSemantics).toBe("jobs-v6");
    expect(inspection.unresolvedCalls).toEqual([]);
    const targetSource = "return import.meta.migration.value;";
    const migrated = migrateSnapshot(fixture.snapshot, {
      source: fixture.source,
      targetSource,
      state: { value: 7 },
      reconciliation: { checkpointDigest: inspection.checkpointDigest, quiescent: true, calls: [] }
    });
    expect(JSON.stringify(fixture.snapshot)).toBe(before);
    expect(migrated.executionSemantics).toBe("jobs-v7");
    expect(migrated.migration?.history[0]).toMatchObject({
      executionSemantics: "jobs-v6",
      replay: fixture.snapshot.replay
    });
    await expect(run(targetSource, { snapshot: migrated })).resolves.toMatchObject({
      ok: true,
      returnValue: 7
    });
  });

  it.each([undefined, "jobs-v1", "jobs-v5", "jobs-v8", null])(
    "rejects unsupported semantics %s before reading caller inputs",
    async (executionSemantics) => {
      const source = "return 7;";
      const original = await run(source);
      const snapshot = { ...original.snapshot, executionSemantics };
      const readInputs = vi.fn(() => {
        throw new Error("caller inputs were read");
      });
      const options = Object.defineProperties(
        { snapshot },
        {
          bindings: { get: readInputs },
          modules: { get: readInputs },
          entryPointArgs: { get: readInputs },
          importMeta: { get: readInputs }
        }
      );
      await expect(run(source, options)).rejects.toMatchObject({
        name: "SnapshotValidationError",
        code: "unsupportedVersion",
        path: "$.executionSemantics"
      });
      expect(readInputs).not.toHaveBeenCalled();
    }
  );
});

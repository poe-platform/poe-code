import { expect, it, vi } from "vitest";
import {
  declareHostOperation,
  dump,
  inspectSnapshotMigration,
  migrateSnapshot,
  run
} from "./index.js";
import fixture from "./__snapshots__/legacy-v8.json" with { type: "json" };
import sourceFixture from "./__snapshots__/legacy-v8-source.json" with { type: "json" };

it.each(["saved", "completed"] as const)(
  "retains genuine v8 transport observations for a %s checkpoint",
  async (kind) => {
    const snapshot = fixture[kind];
    const before = JSON.stringify(snapshot);
    const value = Object.assign(Object.create(null), {
      box: Object.freeze(Object(7)),
      map: new Map([[1, 2]])
    });
    value[Symbol("key")] = value;
    value.map.self = value.map;
    const read = vi.fn(async () => value);
    const bindings = { read: declareHostOperation(read, "re-issue") };
    const result = await run(fixture.source, { snapshot, bindings });
    expect(result).toMatchObject({ ok: true, returnValue: fixture.expected });
    expect(read).toHaveBeenCalledTimes(kind === "saved" ? 1 : 0);
    expect(result.snapshot.executionSemantics).toBe("jobs-v8");
    expect(result.snapshot.replay).toStrictEqual(fixture.completed.replay);
    expect(JSON.stringify(snapshot)).toBe(before);
    const saved = JSON.parse(await dump(result));
    read.mockClear();
    expect(await run(fixture.source, { snapshot: saved, bindings })).toMatchObject({
      ok: true,
      returnValue: fixture.expected,
      snapshot: { executionSemantics: "jobs-v8" }
    });
    expect(read).not.toHaveBeenCalled();
  }
);

it("identifies new transport observations with a new execution marker", async () => {
  expect((await run("return 1;")).snapshot.executionSemantics).toBe("jobs-v9");
});

it.each(["saved", "completed"] as const)(
  "retains v8 function source in a %s checkpoint",
  async (kind) => {
    const read = vi.fn(async () => 7);
    const result = await run(sourceFixture.source, {
      snapshot: sourceFixture[kind],
      bindings: { read: declareHostOperation(read, "re-issue") }
    });
    expect(result).toMatchObject({
      ok: true,
      returnValue: sourceFixture.expected,
      snapshot: { executionSemantics: "jobs-v8" }
    });
    expect(result.snapshot.replay).toStrictEqual(sourceFixture.completed.replay);
    expect(read).toHaveBeenCalledTimes(kind === "saved" ? 1 : 0);
  }
);

it("migrates a genuine v8 source hash while retaining the archived journal", async () => {
  const snapshot = sourceFixture.completed;
  const before = JSON.stringify(snapshot);
  const source = sourceFixture.source;
  const targetSource = "return import.meta.migration;";
  const migrated = migrateSnapshot(snapshot, {
    source,
    targetSource,
    state: 7,
    reconciliation: {
      checkpointDigest: inspectSnapshotMigration(snapshot, { source }).checkpointDigest,
      quiescent: true,
      calls: []
    }
  });
  expect(migrated.executionSemantics).toBe("jobs-v9");
  expect(migrated.migration?.history[0]).toMatchObject({
    executionSemantics: "jobs-v8",
    replay: snapshot.replay
  });
  expect(await run(targetSource, { snapshot: migrated })).toMatchObject({
    ok: true,
    returnValue: 7
  });
  expect(JSON.stringify(snapshot)).toBe(before);
});

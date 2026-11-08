import { expect, it } from "vitest";
import { run } from "./run.js";
import { dump } from "./dump.js";
import { restore } from "./restore.js";
import { inspectSnapshotMigration, migrateSnapshot } from "./migrate.js";

// Synthetic envelope controls complement the unchanged genuine jobs-v6 fixtures.
it.each(
  [1, 2].flatMap((version) =>
    Array.from({ length: 9 }, (_, index) => ({ version, executionSemantics: `jobs-v${index + 1}` }))
  )
)("qualifies format $version with $executionSemantics", async ({ version, executionSemantics }) => {
  const source = "return 1;";
  const snapshot = JSON.parse(await dump(await run(source)));
  snapshot.version = version;
  snapshot.executionSemantics = executionSemantics;
  if (version === 1) {
    snapshot.bindings = {};
    delete snapshot.heap;
  }
  const bytes = JSON.stringify(snapshot);
  if (["jobs-v6", "jobs-v7", "jobs-v8", "jobs-v9"].includes(executionSemantics))
    expect(() => restore(snapshot, { source })).not.toThrow();
  else expect(() => restore(snapshot, { source })).toThrow("incompatible execution semantics");
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
  expect(await run(targetSource, { snapshot: migrated })).toMatchObject({
    ok: true,
    returnValue: 7
  });
  expect(JSON.stringify(snapshot)).toBe(bytes);
});

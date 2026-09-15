import { expect, it } from "vitest";
import { inspectSnapshotMigration, migrateSnapshot } from "../migrate.js";
import { restore } from "../restore.js";
import { run } from "../run.js";
import { SnapshotValidationError } from "./validation.js";

it.each(["version", "sourceHash", "clock", "random", "promiseReplay", "extra"])(
  "rejects caller-installed %s accessors on actual run snapshots without invoking them",
  async (key) => {
    const source = "effect(); return 7;";
    let hostCalls = 0;
    const effect = () => ++hostCalls;
    const result = await run(source, { bindings: { effect } });
    expect(result).toMatchObject({ ok: true, returnValue: 7 });
    expect(hostCalls).toBe(1);
    const snapshot = result.snapshot;
    let invocations = 0;
    const previous = Object.getOwnPropertyDescriptor(snapshot, key);
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      get() {
        invocations++;
        return previous?.value;
      }
    });
    hostCalls = 0;
    for (const boundary of [
      () => restore(snapshot, { source }),
      () => run(source, { snapshot, bindings: { effect } }),
      () => inspectSnapshotMigration(snapshot, { source }),
      () =>
        migrateSnapshot(snapshot, {
          source,
          targetSource: "return import.meta.migration;",
          state: 7,
          reconciliation: { checkpointDigest: "0".repeat(64), quiescent: true, calls: [] }
        })
    ]) {
      let rejected: unknown;
      try {
        await boundary();
      } catch (error) {
        rejected = error;
      }
      expect(invocations).toBe(0);
      expect(hostCalls).toBe(0);
      expect(rejected).toBeInstanceOf(SnapshotValidationError);
      expect(rejected).toMatchObject({ code: "invalidType", path: `$.${key}` });
    }
    if (previous) Object.defineProperty(snapshot, key, previous);
    else Reflect.deleteProperty(snapshot, key);
    const replay = await run(source, { snapshot, bindings: { effect } });
    expect(replay).toMatchObject({ ok: true, returnValue: 7 });
    expect(hostCalls).toBe(0);
    expect(invocations).toBe(0);
  }
);

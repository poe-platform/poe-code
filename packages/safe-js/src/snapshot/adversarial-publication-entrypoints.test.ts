import { expect, it, vi } from "vitest";
import { dump } from "../dump.js";
import { inspectSnapshotMigration, migrateSnapshot } from "../migrate.js";
import { restore, type SafeJSSnapshot } from "../restore.js";
import { run } from "../run.js";
import { decodeReplayData } from "./replay-data.js";

const source = "effect(); return 7;";
const mutations: Array<[string, (snapshot: SafeJSSnapshot) => void]> = [
  [
    "missing version",
    (snapshot) => {
      delete snapshot.version;
    }
  ],
  [
    "future version",
    (snapshot) => {
      snapshot.version = 999;
    }
  ],
  [
    "source mismatch",
    (snapshot) => {
      snapshot.sourceHash = "forged";
    }
  ],
  [
    "oversized string",
    (snapshot) => {
      snapshot.extra = "x".repeat(1_000_001);
    }
  ],
  [
    "oversized key",
    (snapshot) => {
      snapshot["x".repeat(1_000_001)] = 0;
    }
  ],
  [
    "oversized sparse array",
    (snapshot) => {
      snapshot.extra = Array(100_001);
    }
  ],
  [
    "in-memory cycle",
    (snapshot) => {
      snapshot.extra = snapshot;
    }
  ],
  [
    "invalid prototype",
    (snapshot) => {
      snapshot.extra = Object.create({ forged: true });
    }
  ]
];

it.each(mutations)(
  "rejects %s through restore, run and migration without host execution",
  async (_name, mutate) => {
    const effect = vi.fn(() => 1);
    const original = await run(source, { bindings: { effect } });
    expect(original).toMatchObject({ ok: true, returnValue: 7 });
    expect(effect).toHaveBeenCalledOnce();
    const snapshot = JSON.parse(await dump(original)) as SafeJSSnapshot;
    mutate(snapshot);
    effect.mockClear();
    expect(() => restore(snapshot, { source })).toThrow();
    expect(() => inspectSnapshotMigration(snapshot, { source })).toThrow();
    expect(() =>
      migrateSnapshot(snapshot, {
        source,
        targetSource: "return import.meta.migration;",
        state: 7,
        reconciliation: { checkpointDigest: "0".repeat(64), quiescent: true, calls: [] }
      })
    ).toThrow();
    await expect(run(source, { snapshot, bindings: { effect } })).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
  }
);

it.each(["getter", "promiseReplay getter", "proxy"])(
  "rejects a %s without executing its traps at data boundaries",
  async (kind) => {
    const trap = vi.fn(() => {
      throw new Error("host trap ran");
    });
    const hostile =
      kind === "proxy"
        ? new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap })
        : Object.defineProperty({}, kind === "getter" ? "root" : "promiseReplay", {
            get: trap,
            enumerable: true
          });
    expect(() => decodeReplayData(hostile)).toThrow();
    expect(trap.mock.calls.length, "replay decoder").toBe(0);
    expect(() => restore(hostile as SafeJSSnapshot, { source })).toThrow();
    expect(trap.mock.calls.length, "public restore").toBe(0);
    expect(() => inspectSnapshotMigration(hostile as SafeJSSnapshot, { source })).toThrow();
    expect(trap.mock.calls.length, "migration inspection").toBe(0);
    await expect(run(source, { snapshot: hostile as SafeJSSnapshot })).rejects.toThrow();
    expect(trap.mock.calls.length, "run").toBe(0);
  }
);

it.each(["capability", "promise-capability", "input-symbol"])(
  "does not manufacture authority for forged %s identifiers",
  (tag) => {
    expect(() =>
      decodeReplayData({ root: { tag, id: tag === "input-symbol" ? 777 : "__proto__" }, nodes: [] })
    ).toThrow("Missing replay");
  }
);

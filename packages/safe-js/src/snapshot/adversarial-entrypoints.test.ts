import { describe, expect, it, vi } from "vitest";
import { dump } from "../dump.js";
import { inspectSnapshotMigration, migrateSnapshot } from "../migrate.js";
import { hashSource } from "../parse/hash.js";
import { restore, type SafeJSSnapshot } from "../restore.js";
import { run } from "../run.js";
import { EXECUTION_SEMANTICS } from "./dump-format.js";
import { decodeReplayData } from "./replay-data.js";
import { restore as restoreInterpreter } from "./restore.js";
import { serialize } from "./serialize.js";

const source = "return effect();";
const base = (): SafeJSSnapshot => ({ version: 2, executionSemantics: EXECUTION_SEMANTICS,
  sourceHash: hashSource(source), bindings: {}, replay: { version: 1, calls: [] } });
const mutations: Array<[string, (value: SafeJSSnapshot) => void]> = [
  ["missing version", value => { delete value.version; }],
  ["future version", value => { value.version = 999; }],
  ["unknown heap tag", value => { value.heap = { 1: { kind: "forged" } }; }],
  ["missing heap tag", value => { value.heap = { 1: {} }; }],
  ["dangling heap reference", value => { value.bindings = { value: { kind: "ref", id: 99 } }; }],
  ["source mismatch", value => { value.sourceHash = hashSource("return 8;"); }],
  ["oversized string", value => { value.bindings = { data: "x".repeat(1_000_001) }; }],
  ["oversized key", value => { value.bindings = { ["x".repeat(1_000_001)]: 0 }; }],
  ["oversized sparse array", value => { value.bindings = { data: new Array(100_001) }; }],
  ["wire cycle", value => { value.bindings = { cycle: value }; }],
  ["foreign prototype", value => { value.bindings = Object.create({ inherited: 7 }); }]
];

describe.each(mutations)("public malformed snapshot: %s", (_name, mutate) => {
  it("rejects restore, inspection, migration and execution before host effects", async () => {
    const snapshot = base();
    mutate(snapshot);
    const effect = vi.fn(() => 7);
    expect(() => restore(snapshot, { source })).toThrow();
    expect(() => inspectSnapshotMigration(snapshot, { source })).toThrow();
    expect(() => migrateSnapshot(snapshot, { source, targetSource: "return 8;", state: null,
      reconciliation: { checkpointDigest: "0".repeat(64), quiescent: true, calls: [] } })).toThrow();
    await expect(run(source, { snapshot, bindings: { effect } })).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
  });
});

it("accepts the neighboring valid record and invokes only its explicit authority", async () => {
  const effect = vi.fn(() => 7);
  const snapshot = base();
  expect(restore(snapshot, { source })).toBe(snapshot);
  expect(inspectSnapshotMigration(snapshot, { source }).unresolvedCalls).toEqual([]);
  expect(await run(source, { snapshot, bindings: { effect } })).toMatchObject({ ok: true, returnValue: 7 });
  expect(effect).toHaveBeenCalledTimes(1);
});

it.each(["version", "bindings", "nested"])("rejects external snapshot accessors before invoking them: %s", field => {
  const snapshot = base();
  const getter = vi.fn(() => { throw new Error("host getter executed"); });
  const target = field === "nested" ? (snapshot.bindings as object) : snapshot;
  Object.defineProperty(target, field, { enumerable: true, get: getter });
  expect(() => restore(snapshot, { source })).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it.each(["sourceHash", "scopeChain", "nested"])("rejects interpreter snapshot accessors before invoking them: %s", field => {
  const snapshot = serialize({ source: "return 7;", currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: {} }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const getter = vi.fn(() => { throw new Error("host getter executed"); });
  const target = field === "nested" ? snapshot.scopeChain[0].bindings : snapshot;
  Object.defineProperty(target, field, { enumerable: true, get: getter });
  expect(() => restoreInterpreter(snapshot, { source: "return 7;" })).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it.each([false, true])("rejects snapshot proxies without invoking traps (nested=%s)", nested => {
  const trap = vi.fn(() => { throw new Error("proxy trap executed"); });
  const proxy = new Proxy(base(), { get: trap, has: trap, ownKeys: trap,
    getOwnPropertyDescriptor: trap, getPrototypeOf: trap });
  const snapshot = nested ? { ...base(), bindings: { value: proxy } } : proxy;
  expect(() => restore(snapshot, { source })).toThrow();
  expect(() => inspectSnapshotMigration(snapshot, { source })).toThrow();
  expect(() => decodeReplayData({ root: 7, nodes: [proxy] })).toThrow();
  expect(trap).not.toHaveBeenCalled();
});

it.each([1, 2])("accepts explicit version %s legacy scalar records", version => {
  const snapshot = { version, sourceHash: hashSource("return 7;"), bindings: { value: 7 },
    clock: { next: 0 }, random: { seed: 1, state: 1 } };
  expect(restore(snapshot, { source: "return 7;" })).toBe(snapshot);
});

it.each([1, 2])("preserves graph identity from an explicit version %s legacy heap fixture", version => {
  const reference = { kind: "ref" as const, id: 1 };
  const bindings = { left: reference, right: reference };
  const heap = { 1: { kind: "object" as const, entries: { self: reference } } };
  const sourceHash = hashSource("return 7;");
  const envelope = { version, sourceHash, bindings, heap };
  expect(restore(envelope, { source: "return 7;" })).toBe(envelope);
  const restored = restoreInterpreter({ sourceHash, currentAstNodeId: 1, heap,
    scopeChain: [{ id: "module", bindings }], callStack: [], pendingPromises: [], moduleBindings: {} },
  { source: "return 7;" });
  const left = restored.currentScope.lookup("left").value as { self: unknown };
  expect(left).toBe(restored.currentScope.lookup("right").value);
  expect(left.self).toBe(left);
});

it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])("migrates an explicit jobs-v%s empty journal with reconciled application state", edition => {
  const code = "return 7;";
  const snapshot = { version: 2, executionSemantics: `jobs-v${edition}`,
    sourceHash: hashSource(code, undefined, edition >= 8), bindings: {}, replay: { version: 1, calls: [] } };
  const inspection = inspectSnapshotMigration(snapshot, { source: code });
  const shared = { value: 7 };
  const migrated = migrateSnapshot(snapshot, { source: code, targetSource: code,
    state: { left: shared, right: shared },
    reconciliation: { checkpointDigest: inspection.checkpointDigest, quiescent: true, calls: [] } });
  const state = decodeReplayData(migrated.migration.state) as { left: unknown; right: unknown };
  expect(state.left).toBe(state.right);
  expect(restore(migrated, { source: code })).toBe(migrated);
});

it.each(["jobs-v6", "jobs-v7", "jobs-v8", EXECUTION_SEMANTICS])("accepts the documented resume semantics %s", executionSemantics => {
  const snapshot = { version: 2, executionSemantics,
    sourceHash: hashSource("return 7;", undefined, executionSemantics !== "jobs-v6" && executionSemantics !== "jobs-v7"),
    bindings: {}, replay: { version: 1, calls: [] } };
  expect(restore(snapshot, { source: "return 7;" })).toBe(snapshot);
});

it.each(["jobs-v1", "jobs-v5", "jobs-v999"])("gives actionable unsupported-resume diagnostics for %s", executionSemantics => {
  expect(() => restore({ ...base(), executionSemantics }, { source })).toThrow("Migration requires explicit reconciliation");
});

it("preserves current public snapshot graph identity on replay", async () => {
  const code = "const a={};a.self=a;const b=[a,a];return [b[0]===b[1],a.self===a];";
  const first = run(code);
  expect(await first).toMatchObject({ ok: true, returnValue: [true, true] });
  const snapshot = restore(JSON.parse(await dump(first)), { source: code });
  expect(await run(code, { snapshot })).toMatchObject({ ok: true, returnValue: [true, true] });
});

it.each([
  { root: {}, nodes: [] },
  { root: { tag: "forged" }, nodes: [] },
  { root: { tag: "ref", id: 99 }, nodes: [] },
  { root: { tag: "number", value: "invalid" }, nodes: [] },
  { root: { tag: "capability", id: "" }, nodes: [] },
  { root: { tag: "promise-capability", id: 7 }, nodes: [] }
])("rejects malformed replay atoms without capability lookup: %j", graph => {
  const resolveCapability = vi.fn();
  const resolvePromise = vi.fn();
  expect(() => decodeReplayData(graph, { resolveCapability, resolvePromise })).toThrow();
  expect(resolveCapability).not.toHaveBeenCalled();
  expect(resolvePromise).not.toHaveBeenCalled();
});

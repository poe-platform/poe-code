import { afterEach, describe, expect, it, vi } from "vitest";

import { Budget } from "../interp/budget.js";
import { declareHostOperation } from "../interp/host-bridge.js";
import type { Scope } from "../interp/scope.js";
import { parseModule } from "../parse/parser.js";
import { restore as restoreDump, type SafeJSSnapshot } from "../restore.js";
import { run } from "../run.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue, type SerializedSnapshot } from "./serialize.js";

const source = "return null;";

function roundTrip(bindings: Record<string, RuntimeSnapshotValue>, format: string) {
  const currentAstNodeId = parseModule(source).body[0]?.nodeId;
  if (currentAstNodeId === undefined) throw new Error("Missing parsed node ID");
  const input = {
    source,
    currentAstNodeId,
    scopeChain: [{ id: "module", bindings }],
    callStack: [],
    pendingPromises: [],
    moduleBindings: {}
  };
  let snapshot: SerializedSnapshot;
  if (format === "interpreter") {
    snapshot = JSON.parse(JSON.stringify(serialize(input)));
  } else {
    const dumped = restoreDump(
      JSON.parse(
        serializeSafeJSSnapshot({
          sourceHash: serialize({ ...input, scopeChain: [] }).sourceHash,
          bindings
        })
      ),
      { source }
    );
    snapshot = {
      ...serialize({ ...input, scopeChain: [] }),
      scopeChain: [{ id: "module", bindings: dumped.bindings }],
      heap: dumped.heap
    };
  }
  return restore(snapshot, { source }).currentScope;
}

function readBinding(scope: Scope, name: string) {
  const binding = scope.lookup(name);
  if (!binding.found) throw new Error(`Missing restored binding: ${name}`);
  return binding.value;
}

describe.each(["interpreter", "dump"])("%s array checkpoint shape", (format) => {
  it.each(["empty", "sparse", "dense"])(
    "preserves %s holes, length, undefined and null",
    (shape) => {
      const rows = new Array<RuntimeSnapshotValue>(5);
      if (shape !== "empty") {
        rows[1] = undefined;
        rows[3] = null;
      }
      if (shape === "dense") rows.fill(undefined);
      const restored = readBinding(roundTrip({ rows }, format), "rows") as RuntimeSnapshotValue[];
      expect(restored).toStrictEqual(structuredClone(rows));
      expect(Object.keys(restored)).toEqual(Object.keys(rows));
      expect(restored.length).toBe(5);
      expect(restored).not.toBe(rows);
    }
  );

  it("preserves sparse indexed aliases and cycles", () => {
    const shared = { count: 5 };
    const rows = new Array<RuntimeSnapshotValue>(6);
    rows[1] = shared;
    rows[3] = shared;
    rows[4] = rows;
    const restored = roundTrip({ rows, alias: rows, shared }, format);
    const actual = readBinding(restored, "rows") as RuntimeSnapshotValue[];
    expect(structuredClone(actual)).toStrictEqual(structuredClone(rows));
    expect(actual).toBe(readBinding(restored, "alias"));
    expect(actual[1]).toBe(readBinding(restored, "shared"));
    expect(actual[1]).toBe(actual[3]);
    expect(actual[4]).toBe(actual);
    expect(Object.keys(actual)).toEqual(["1", "3", "4"]);
  });

  it("preserves separately observed named metadata and raw aliases", () => {
    const metadata = { count: 5 };
    const rows = Object.assign([metadata], { metadata, raw: metadata });
    const object = { metadata, raw: metadata };
    const restored = roundTrip({ rows, alias: rows, metadata, object }, format);
    const actual = readBinding(restored, "rows") as typeof rows;
    const actualMetadata = readBinding(restored, "metadata");
    expect(Object.keys(actual)).toEqual(["0", "metadata", "raw"]);
    expect(actual).toBe(readBinding(restored, "alias"));
    expect(actual[0]).toBe(actualMetadata);
    expect(actual.metadata).toBe(actualMetadata);
    expect(actual.raw).toBe(actualMetadata);
    expect(readBinding(restored, "object")).toEqual({
      metadata: actualMetadata,
      raw: actualMetadata
    });
  });

  it("discovers aliases and cycles reachable only through named entries", () => {
    const metadata = { count: 5 };
    const rows = Object.assign([], { metadata, raw: metadata, missing: undefined });
    Object.assign(rows, { self: rows });
    const actual = readBinding(roundTrip({ rows }, format), "rows") as typeof rows & {
      self: unknown;
    };
    expect(actual.length).toBe(0);
    expect(Object.keys(actual)).toEqual(["metadata", "raw", "missing", "self"]);
    expect(actual.metadata).toEqual(metadata);
    expect(actual.metadata).toBe(actual.raw);
    expect(actual.self).toBe(actual);
    expect(Object.hasOwn(actual, "missing")).toBe(true);
    expect(actual.missing).toBeUndefined();
  });

  it("retains dense heap arrays and explicit undefined", () => {
    const rows = [undefined, null, 3];
    const restored = roundTrip({ rows, alias: rows }, format);
    expect(readBinding(restored, "rows")).toStrictEqual(rows);
    expect(readBinding(restored, "rows")).toBe(readBinding(restored, "alias"));
  });
});

describe("sparse clone and automatic checkpoints", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["Array(2)", "[, undefined, null, ,]", "[1, 2]"])(
    "matches native structuredClone for %s",
    async (expression) => {
      const program = `const rows = ${expression}; const clone = structuredClone(rows); return { clone, keys: Object.keys(clone), length: clone.length, detached: clone !== rows };`;
      const expected = new Function(program)();
      const result = await run(program);
      expect(result).toMatchObject({ ok: true });
      if (result.ok) expect(structuredClone(result.returnValue)).toStrictEqual(expected);
    }
  );

  it("clones sparse cycles and aliases without densifying", async () => {
    const program = `const rows = Array(6); const shared = { count: 5 }; rows[1] = shared; rows[3] = shared; rows[4] = rows; const clone = structuredClone(rows); return { length: clone.length, keys: Object.keys(clone), alias: clone[1] === clone[3], cycle: clone[4] === clone, detached: clone !== rows && clone[1] !== shared };`;
    expect(await run(program)).toMatchObject({ ok: true, returnValue: new Function(program)() });
  });

  it("serializes sparse automatic checkpoints and resumes with preserved shape", async () => {
    const program = `const rows = Array(5); rows[1] = undefined; rows[3] = { count: 5 }; const alias = rows; await wait(); return { keys: Object.keys(rows), length: rows.length, present: Object.hasOwn(rows, 1), hole: Object.hasOwn(rows, 0), alias: rows === alias, count: rows[3].count };`;
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const checkpoints: SafeJSSnapshot[] = [];
    const errors: unknown[] = [];
    let release: (() => void) | undefined;
    const result = await run(program, {
      budget: new Budget({ maxSteps: 2_000 }),
      bindings: {
        wait: declareHostOperation(async () => {
          clock.mockReturnValue(2);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }, "re-issue")
      },
      snapshotIntervalMs: 1,
      snapshotBackend: {
        async read() {
          return undefined;
        },
        async remove() {},
        async write(snapshot) {
          try {
            checkpoints.push(JSON.parse(serializeSafeJSSnapshot(snapshot)));
          } catch (error) {
            errors.push(error);
          } finally {
            release?.();
          }
        }
      }
    });
    expect(result).toMatchObject({ ok: true });
    expect(errors).toEqual([]);
    expect(checkpoints.length).toBeGreaterThan(0);
    for (const checkpoint of checkpoints) {
      const resumed = await run(program, {
        snapshot: restoreDump(checkpoint, { source: program }),
        bindings: { wait: declareHostOperation(async () => undefined, "re-issue") },
        budget: new Budget({ maxSteps: 2_000 })
      });
      expect(resumed).toMatchObject({
        ok: true,
        returnValue: result.ok ? result.returnValue : undefined
      });
    }
  });
});

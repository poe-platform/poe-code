import { describe, expect, it } from "vitest";

import type { Scope } from "../interp/scope.js";
import { hashSource } from "../parse/hash.js";
import { parseModule } from "../parse/parser.js";
import { restore as restoreDump } from "../restore.js";
import { EXECUTION_SEMANTICS, serializeSafeJSSnapshot } from "./dump-format.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue, type SerializedSnapshot } from "./serialize.js";

const source = "return null;";

function snapshotInput(bindings: Record<string, RuntimeSnapshotValue>) {
  const currentAstNodeId = parseModule(source).body[0]!.nodeId;
  if (currentAstNodeId === undefined) throw new Error("Missing parsed node ID");
  return {
    source,
    currentAstNodeId,
    scopeChain: [{ id: "module", bindings }],
    callStack: [],
    pendingPromises: [],
    moduleBindings: {}
  };
}

function capture(bindings: Record<string, RuntimeSnapshotValue>, format: string) {
  let encoded: SerializedSnapshot;
  if (format === "interpreter") {
    encoded = JSON.parse(JSON.stringify(serialize(snapshotInput(bindings))));
  } else {
    const envelope = JSON.parse(
      serializeSafeJSSnapshot({
        sourceHash: hashSource(source),
        executionSemantics: EXECUTION_SEMANTICS,
        bindings
      })
    );
    expect(envelope.version).toBe(1);
    expect(envelope.executionSemantics).toBe("jobs-v8");
    const validated = restoreDump(envelope, { source });
    encoded = {
      ...serialize(snapshotInput({})),
      scopeChain: [{ id: "module", bindings: validated.bindings }],
      heap: validated.heap
    };
  }
  return restore(encoded, { source }).currentScope;
}

function readBinding(scope: Scope, name: string) {
  const binding = scope.lookup(name);
  if (!binding.found) throw new Error(`Missing restored binding: ${name}`);
  return binding.value;
}

describe.each(["interpreter", "dump"])("independent OBJ002 %s", (format) => {
  it("retains the original metadata/raw observation's complete alias graph", () => {
    const metadata = { count: 5 };
    const rows = Object.assign([metadata], { metadata, raw: metadata });
    const object = { metadata, raw: metadata };
    const restored = capture({ rows, alias: rows, metadata, object }, format);
    const actual = readBinding(restored, "rows") as typeof rows;
    const actualMetadata = readBinding(restored, "metadata");
    const actualObject = readBinding(restored, "object") as typeof object;
    expect({
      arrayAlias: actual === readBinding(restored, "alias"),
      indexAlias: actual[0] === actualMetadata,
      metadataAlias: actual.metadata === actualMetadata,
      rawAlias: actual.raw === actualMetadata,
      ownMetadata: Object.hasOwn(actual, "metadata"),
      keys: Object.keys(actual),
      objectMetadataAlias: actualObject.metadata === actualMetadata
    }).toEqual({
      arrayAlias: true,
      indexAlias: true,
      metadataAlias: true,
      rawAlias: true,
      ownMetadata: true,
      keys: ["0", "metadata", "raw"],
      objectMetadataAlias: true
    });
    expect(actualObject.raw).toBe(actualMetadata);
    expect(actual.metadata.count).toBe(5);
    expect(actual).not.toBe(rows);
  });

  it.each([0, 2, 9])("preserves an all-hole array of length %i", (length) => {
    const rows = new Array<RuntimeSnapshotValue>(length);
    const actual = readBinding(capture({ rows }, format), "rows") as typeof rows;
    expect(actual.length).toBe(length);
    expect(Object.keys(actual)).toEqual([]);
    expect(actual).toStrictEqual(rows);
  });

  it("distinguishes holes, indexed undefined, null and named undefined", () => {
    const rows = Object.assign(new Array<RuntimeSnapshotValue>(6), { metadata: undefined });
    rows[1] = undefined;
    rows[3] = null;
    const actual = readBinding(capture({ rows }, format), "rows") as typeof rows;
    expect(actual.length).toBe(6);
    expect(Object.keys(actual)).toEqual(["1", "3", "metadata"]);
    expect(Object.hasOwn(actual, "0")).toBe(false);
    expect(Object.hasOwn(actual, "1")).toBe(true);
    expect(actual[1]).toBeUndefined();
    expect(actual[3]).toBeNull();
    expect(Object.hasOwn(actual, "metadata")).toBe(true);
    expect(actual.metadata).toBeUndefined();
  });

  it("discovers named-only references and mutual cycles without extra roots", () => {
    const rows = Object.assign(new Array<RuntimeSnapshotValue>(3), {
      metadata: {} as Record<string, RuntimeSnapshotValue>,
      raw: [] as RuntimeSnapshotValue[]
    });
    rows.metadata.owner = rows;
    rows.metadata.raw = rows.raw;
    rows.raw[0] = rows;
    rows.raw[1] = rows.metadata;
    const actual = readBinding(capture({ rows }, format), "rows") as typeof rows;
    expect(Object.keys(actual)).toEqual(["metadata", "raw"]);
    expect(actual.length).toBe(3);
    expect(actual.metadata.owner).toBe(actual);
    expect(actual.metadata.raw).toBe(actual.raw);
    expect(actual.raw[0]).toBe(actual);
    expect(actual.raw[1]).toBe(actual.metadata);
  });

  it("preserves shape and shared identities across two independent captures", () => {
    const metadata = { count: 5 };
    let rows = Object.assign(new Array<RuntimeSnapshotValue>(5), { metadata, raw: metadata });
    rows[2] = metadata;
    rows[4] = rows;
    for (let generation = 0; generation < 2; generation += 1) {
      const restored = capture({ rows, alias: rows }, format);
      rows = readBinding(restored, "rows") as typeof rows;
      expect(rows).toBe(readBinding(restored, "alias"));
      expect(rows[2]).toBe(rows.metadata);
      expect(rows.raw).toBe(rows.metadata);
      expect(rows[4]).toBe(rows);
      expect(rows.metadata.count).toBe(5);
      expect(rows.length).toBe(5);
      expect(Object.keys(rows)).toEqual(["2", "4", "metadata", "raw"]);
    }
  });
});

describe("independent OBJ002 supported older array encodings", () => {
  it.each(["inline", "heap items"])("restores a previously supported %s array", (encoding) => {
    const snapshot = serialize(snapshotInput({}));
    const items = [{ kind: "undefined" as const }, null, 7];
    if (encoding === "inline") {
      snapshot.scopeChain[0]!.bindings.rows = items;
    } else {
      snapshot.scopeChain[0]!.bindings.rows = { kind: "ref", id: 1 };
      snapshot.scopeChain[0]!.bindings.alias = { kind: "ref", id: 1 };
      snapshot.heap = { "1": { kind: "array", items } };
    }
    const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source }).currentScope;
    const rows = readBinding(restored, "rows");
    expect(rows).toStrictEqual([undefined, null, 7]);
    expect(Object.keys(rows as object)).toEqual(["0", "1", "2"]);
    if (encoding === "heap items") expect(rows).toBe(readBinding(restored, "alias"));
  });

  it("restores a legacy items self-reference without rewriting its representation", () => {
    const snapshot = serialize(snapshotInput({}));
    snapshot.scopeChain[0]!.bindings.rows = { kind: "ref", id: 1 };
    snapshot.heap = { "1": { kind: "array", items: [{ kind: "ref", id: 1 }] } };
    const rows = readBinding(restore(snapshot, { source }).currentScope, "rows") as unknown[];
    expect(rows.length).toBe(1);
    expect(rows[0]).toBe(rows);
  });
});

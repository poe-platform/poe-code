import { describe, expect, it } from "vitest";

import { Budget } from "../interp/budget.js";
import { createSubsetErrorValue, isSandboxErrorConstructorInstance } from "../interp/exceptions.js";
import { deepCopyToSandbox } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { hashSource } from "../parse/hash.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";
import { SnapshotValidationError, validateDumpEnvelope } from "./validation.js";

describe("error identity in snapshot data", () => {
  it.each(["Error", "TypeError", "AgentSpawnError"])(
    "preserves %s identity independently of its mutable name",
    (name) => {
      const failure = createSubsetErrorValue(name, "failed", [], new Budget());
      failure.name = "renamed";
      const copied = deepCopyToSandbox(failure);
      const replayed = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(copied))));
      const source = "return 0;";
      const snapshot = serialize({
        source,
        currentAstNodeId: parseModule(source).body[0].nodeId!,
        scopeChain: [{ id: "module", bindings: { failure } }],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      });
      const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source }).currentScope.lookup(
        "failure"
      );
      expect(binding.found).toBe(true);
      if (!binding.found) throw new Error("Missing restored error");
      for (const value of [copied, replayed, binding.value]) {
        expect(isSandboxErrorConstructorInstance(value, "Error")).toBe(true);
        expect(isSandboxErrorConstructorInstance(value, "TypeError")).toBe(name === "TypeError");
        expect(value).toMatchObject({ name: "renamed", message: "failed" });
      }
    }
  );

  it("does not infer error identity from ordinary object fields", () => {
    const value = { name: "TypeError", message: "failed", stack: "TypeError: failed" };
    const restored = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(value))));

    expect(isSandboxErrorConstructorInstance(restored, "Error")).toBe(false);
  });

  it("records error identity in public dumps even without aliases", () => {
    const failure = createSubsetErrorValue("TypeError", "failed", [], new Budget());
    const dumped = JSON.parse(
      serializeSafeJSSnapshot({ sourceHash: hashSource("return 0;"), failure })
    );

    expect(dumped.failure).toMatchObject({ kind: "ref" });
    expect(dumped.heap[String(dumped.failure.id)]).toMatchObject({
      kind: "object",
      errorType: "TypeError"
    });
    expect(() => validateDumpEnvelope(dumped)).not.toThrow();
  });

  it.each([null, "Function", "AgentSpawnError", 7, {}])(
    "rejects invalid replay error metadata %j",
    (errorType) => {
      const encoded = encodeReplayData({ name: "Error" });
      Reflect.set(encoded.nodes[0], "errorType", errorType);

      expect(() => decodeReplayData(encoded)).toThrow("error metadata");
    }
  );

  it.each(["object", "array"])("rejects invalid %s error metadata in dump heaps", (kind) => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("return 0;"),
      value: { kind: "ref", id: 1 },
      heap: {
        "1": { kind, errorType: kind === "array" ? "Error" : "Function", entries: {}, items: [] }
      }
    };

    expect(() => validateDumpEnvelope(snapshot)).toThrow(SnapshotValidationError);
  });

  it.each([
    { kind: "map", entries: [] },
    { kind: "set", values: [] },
    { kind: "regex", source: "", flags: "", lastIndex: 0 }
  ])("rejects error metadata on replay $kind values", (node) => {
    const encoded = encodeReplayData({});
    encoded.nodes[0] = { ...node, errorType: "Error" } as (typeof encoded.nodes)[number];

    expect(() => decodeReplayData(encoded)).toThrow("error metadata");
  });
});

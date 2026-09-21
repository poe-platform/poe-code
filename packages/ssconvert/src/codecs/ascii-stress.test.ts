import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { createRegistry } from "./registry.js";
import type { Codec } from "./types.js";

const read: NonNullable<Codec["read"]> = async () => ({ sheets: [] });
function context(signal = new AbortController().signal): CapabilityContext {
  return {
    signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 8, outputBytes: 8, cells: 1, sheets: 1, operations: 10 },
    own() {}
  };
}

// Independent names: plugin probes use GLib Unicode lowercase, including the
// Kelvin sign; fullwidth letters, parent directories and trailing dots differ.
it.each([
  ["/parent.wk1/book.Wk1", "Gnumeric_lotus:lotus"],
  ["/parent.WK1/book", "content-first"],
  ["book.wK1", "Gnumeric_lotus:lotus"],
  ["book.ｗk1", "content-first"],
  ["book.WK1.", "content-first"],
  ["book.WK1/unrelated", "content-first"]
])("keeps plugin filename probing in the native basename domain for %s", async (filename, expected) => {
  const registry = createRegistry([
    { id: "content-first", description: "control", extensions: [], read,
      probePriority: 100, probeContent: () => true },
    { id: "Gnumeric_lotus:lotus", description: "fixture", extensions: [], read,
      probeContent: (bytes) => bytes[0] === 91 }
  ]);
  expect((await registry.probe(new Uint8Array([91]), filename, context()))?.id).toBe(expected);
  // Positive names cannot bypass content validation.
  expect((await registry.probe(new Uint8Array([0]), filename, context()))?.id).toBe("content-first");
});

it.each([0, false, null, "cancelled"])("preserves cancellation reason identity %s after name probing", async (reason) => {
  const controller = new AbortController();
  let contentCalls = 0;
  const registry = createRegistry([{
    id: "fixture", description: "fixture", extensions: [], read,
    probeName: async () => { await Promise.resolve(); controller.abort(reason); return true; },
    probeContent: () => { contentCalls++; return true; }
  }]);
  await expect(registry.probe(new Uint8Array([91]), "book.xlsx", context(controller.signal))).rejects.toBe(reason);
  expect(contentCalls).toBe(0);
});

it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid byte budget %s before host probes", async (inputBytes) => {
  let calls = 0;
  const registry = createRegistry([{
    id: "fixture", description: "fixture", extensions: [], read,
    probeContent: () => { calls++; return true; }
  }]);
  const supplied = context();
  await expect(registry.probe(new Uint8Array(), undefined, {
    ...supplied, limits: { ...supplied.limits, inputBytes }
  })).rejects.toMatchObject({ code: "resource-limit" });
  expect(calls).toBe(0);
});

it("uses borrowed cross-realm cancellation without admitting content work", async () => {
  const reason = runInNewContext("({ cancelled: true })") as object;
  const controller = new AbortController();
  controller.abort(reason);
  let calls = 0;
  const registry = createRegistry([{
    id: "fixture", description: "fixture", extensions: [], read,
    probeContent: () => { calls++; return true; }
  }]);
  await expect(registry.probe(new Uint8Array([91]), undefined, context(controller.signal))).rejects.toBe(reason);
  expect(calls).toBe(0);
});

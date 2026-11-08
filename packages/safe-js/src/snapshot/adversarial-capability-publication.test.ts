import { expect, it, vi } from "vitest";
import { createSandboxClosure } from "../interp/values.js";
import { decodeReplayData } from "./replay-data.js";

const ref = (id: number) => ({ tag: "ref", id });
const property = (value: unknown) => ({
  value,
  writable: true,
  enumerable: true,
  configurable: true
});
const object = (properties: Record<string, unknown>) => ({
  kind: "object",
  properties,
  extensible: true,
  nullPrototype: false
});

// Fixed, minimized mutations; no randomness, host I/O, timers or native waits.
const invalidNodes = [
  ["missing kind", {}],
  ["unknown kind", { kind: "future-object" }],
  ["dangling reference", object({ bad: property(ref(99)) })],
  ["missing atom tag", object({ bad: property({ id: 0 }) })],
  ["unknown atom tag", object({ bad: property({ tag: "future-value" }) })],
  ["invalid prototype", { ...object({}), sandboxNullPrototype: false }],
  ["invalid private slots", { kind: "temporal-instant", epochNanoseconds: "invalid" }],
  [
    "invalid descriptor",
    object({ bad: { value: 1, writable: "yes", enumerable: true, configurable: true } })
  ]
] as const;

it.each(invalidNodes)(
  "does not publish a partial capability before rejecting %s",
  (_name, invalid) => {
    const call = vi.fn(() => 7);
    const capability = createSandboxClosure({ call });
    const published = vi.fn();
    const graph = {
      root: ref(0),
      nodes: [
        object({ first: property(ref(1)), later: property(ref(3)) }),
        { kind: "capability", id: "explicit", properties: ref(2) },
        object({ self: property(ref(1)) }),
        invalid
      ]
    };
    const before = JSON.stringify(graph);
    expect(() =>
      decodeReplayData(graph, {
        resolveCapability: (id) => (id === "explicit" ? capability : undefined),
        onCapabilityRestored: published
      })
    ).toThrow();
    expect(published).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    expect(JSON.stringify(graph)).toBe(before);
  }
);

it("publishes an accepted cyclic capability exactly once without calling it", () => {
  const call = vi.fn(() => 7);
  const capability = createSandboxClosure({ call });
  const published = vi.fn();
  const restored = decodeReplayData(
    {
      root: ref(0),
      nodes: [
        { kind: "capability", id: "explicit", properties: ref(1) },
        object({ self: property(ref(0)) })
      ]
    },
    { resolveCapability: () => capability, onCapabilityRestored: published }
  );
  expect(published).toHaveBeenCalledExactlyOnceWith(capability, restored);
  expect(restored).toHaveProperty("properties.self", restored);
  expect(call).not.toHaveBeenCalled();
});

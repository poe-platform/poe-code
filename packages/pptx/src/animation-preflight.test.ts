import { expect, it, vi } from "vitest";
import { mutateAnimations, mutateAnimationsBatch, type MutateAnimationsOptions } from "./animation-editing.js";
import type { SelectionContext } from "./selectors.js";

const context: SelectionContext = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: { maxArchiveBytes: 262144, maxEntryBytes: 65536, maxTotalBytes: 262144, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 65536, chunkSize: 4096 },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 48 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
const valid = { kind: "appear", trigger: "on-click", target: { slide: { coordinateSystem: "one-based", value: 1 }, shape: "Badge" } } as const;
const malformed: readonly [string, unknown][] = [
  ["unencoded target", { target: "Badge" }],
  ["empty target name", { target: { slide: { coordinateSystem: "one-based", value: 1 }, shape: "" } }],
  ["unknown target coordinate system", { target: { slide: { coordinateSystem: "relative", value: 1 }, shape: "Badge" } }],
  ["zero one-based target", { target: { slide: { coordinateSystem: "one-based", value: 0 }, shape: "Badge" } }],
  ["fractional target", { target: { slide: { coordinateSystem: "zero-based", value: 0.5 }, shape: "Badge" } }],
  ["incomplete target location", { target: { fingerprint: "a".repeat(64), coordinateSystem: "identity" } }],
  ["null selector position", { selection: { position: null } }],
  ["unknown selector kind", { selection: { kind: "paragraph" } }],
  ["nonboolean cardinality", { selection: { all: "yes" } }],
  ["conflicting coordinates", { selection: { id: "256", position: { coordinateSystem: "one-based", value: 1 } } }],
  ["mixed token selector", { selection: { token: "{}", name: "Badge" } }],
  ["nonstring selector name", { selection: { name: 7 } }],
  ["malformed owner", { selection: { kind: "object", owner: "../slide.xml", id: "2" } }]
];
it.each(malformed)("rejects %s before reading any input", async (_name, update) => {
  const options = { ...valid, ...(update as object) } as MutateAnimationsOptions;
  const read = vi.fn(async () => null);
  await expect(mutateAnimations({ read }, "add", options, context)).rejects.toMatchObject({ code: "invalid-value" });
  expect(read).not.toHaveBeenCalled();
  await expect(mutateAnimationsBatch({ read }, [
    { action: "add", options: valid }, { action: "add", options }
  ], context)).rejects.toMatchObject({ code: "invalid-value" });
  expect(read).not.toHaveBeenCalled();
});
it("rejects non-data location values without invoking serialization hooks", async () => {
  const toJSON = vi.fn(() => "a".repeat(64));
  const read = vi.fn(async () => null);
  for (const value of [{ toJSON }, 1n]) {
    const target = { fingerprint: value, scope: "slides", owner: "/ppt/slides/slide1.xml", objectId: "2", coordinateSystem: "identity" };
    await expect(mutateAnimationsBatch({ read }, [
      { action: "add", options: { ...valid, target } as unknown as MutateAnimationsOptions }
    ], context)).rejects.toMatchObject({ code: "invalid-value" });
  }
  expect(toJSON).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
